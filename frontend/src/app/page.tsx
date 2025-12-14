"use client";

import Image from "next/image";
import React, { useState } from "react";

type Role = "user" | "assistant" | "system";

type SearchIntentResponse = {
  escalate: boolean;
  safety_message?: string | null;
  not_medical_advice: string;
  visit_reason_code?: string | null;
  visit_reason_label?: string | null;
  recommended_provider_type?:
    | "primary_care"
    | "urgent_care"
    | "dermatology"
    | "orthopedics"
    | null;
  confidence?: string | null;
};

type CareOption = {
  provider_type:
    | "primary_care"
    | "urgent_care"
    | "dermatology"
    | "orthopedics";
  label: string;
  suggested: boolean;
};

type CareOptionsResponse = { options: CareOption[] };

type AvailabilitySlot = {
  provider_id: string;
  provider_name: string;
  location_id: string;
  location_name: string;
  start: string;
  end: string;
  mode: "in_person" | "virtual";
};

type AvailabilityResponse = { slots: AvailabilitySlot[] };

type CreateHoldResponse = {
  hold_id: string;
  expires_at: string;
};

type BookAppointmentResponse = {
  appointment_id: string;
  provider_name: string;
  location_name: string;
  start: string;
  end: string;
  mode: "in_person" | "virtual";
  status: "confirmed";
};

type Msg = { role: Role; text: string };

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE ?? "http://127.0.0.1:8000";

function todayISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export default function Page() {
  const [sessionId] = useState(
    () => "sess_" + Math.random().toString(16).slice(2)
  );
  const [messages, setMessages] = useState<Msg[]>([
    {
      role: "assistant",
      text: "Hi! Tell me what’s going on and I’ll help you schedule care.",
    },
    {
      role: "system",
      text: "This is a demo scheduling assistant (not medical advice).",
    },
  ]);

  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  const [intent, setIntent] = useState<SearchIntentResponse | null>(
    null
  );
  const [careOptions, setCareOptions] =
    useState<CareOption[] | null>(null);

  const [selectedCareType, setSelectedCareType] =
    useState<CareOption["provider_type"] | null>(null);
  const [mode, setMode] = useState<"in_person" | "virtual">(
    "in_person"
  );
  const [availability, setAvailability] =
    useState<AvailabilitySlot[] | null>(null);
  const [selectedSlot, setSelectedSlot] =
    useState<AvailabilitySlot | null>(null);
  const [holdId, setHoldId] = useState<string | null>(null);
  const [holdExpiresAt, setHoldExpiresAt] = useState<string | null>(null);

  const [patientFirstName, setPatientFirstName] = useState("Alex");
  const [patientLastName, setPatientLastName] = useState("Rivera");
  const [patientDob, setPatientDob] = useState("1990-01-15");
  const [patientPhone, setPatientPhone] = useState("3125550101");
  const [patientEmail, setPatientEmail] = useState("alex@example.com");
  const [patientNotes, setPatientNotes] = useState("");

  const [bookingStatus, setBookingStatus] = useState<string | null>(null);

  function getErrorMessage(error: unknown) {
    if (error instanceof Error) return error.message;
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }

  async function postJSON<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  async function getJSON<T>(path: string): Promise<T> {
    const res = await fetch(`${API_BASE}${path}`);
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  async function handleSend() {
    if (!input.trim()) return;

    const text = input.trim();
    setInput("");
    setAvailability(null);
    setSelectedSlot(null);
    setHoldId(null);
    setHoldExpiresAt(null);
    setCareOptions(null);
    setSelectedCareType(null);
    setIntent(null);
    setBookingStatus(null);

    setMessages((m) => [...m, { role: "user", text }]);
    setLoading(true);

    try {
      const intentResp = await postJSON<SearchIntentResponse>(
        "/api/search-intent",
        {
          session_id: sessionId,
          message: text,
          mode_preference: mode,
        }
      );

      setIntent(intentResp);

      if (intentResp.escalate) {
        setMessages((m) => [
          ...m,
          {
            role: "assistant",
            text:
              intentResp.safety_message ??
              "This may require immediate care.",
          },
        ]);
        return;
      }

      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          text: `I can help schedule care for ${intentResp.visit_reason_label}.`,
        },
      ]);

      const opts = await getJSON<CareOptionsResponse>(
        `/api/care-options?visit_reason_code=${encodeURIComponent(
          intentResp.visit_reason_code ?? "GENERIC"
        )}&recommended_provider_type=${encodeURIComponent(
          intentResp.recommended_provider_type ?? "primary_care"
        )}`
      );

      setCareOptions(opts.options);
      const suggested =
        opts.options.find((o) => o.suggested)?.provider_type ??
        opts.options[0]?.provider_type ??
        null;
      setSelectedCareType(suggested);
    } catch (e: unknown) {
      setMessages((m) => [
        ...m,
        { role: "assistant", text: `Error: ${getErrorMessage(e)}` },
      ]);
    } finally {
      setLoading(false);
    }
  }

  async function loadAvailability() {
    if (!selectedCareType || !intent?.visit_reason_code) return;

    setSelectedSlot(null);
    setHoldId(null);
    setHoldExpiresAt(null);
    setBookingStatus(null);
    setLoading(true);
    try {
      const resp = await getJSON<AvailabilityResponse>(
        `/api/availability?provider_type=${selectedCareType}&start_date=${todayISO()}&days=7&mode=${mode}&visit_reason_code=${intent.visit_reason_code}`
      );
      setAvailability(resp.slots);
    } catch (e: unknown) {
      setMessages((m) => [
        ...m,
        { role: "assistant", text: getErrorMessage(e) },
      ]);
    } finally {
      setLoading(false);
    }
  }

  async function holdSlot(slot: AvailabilitySlot) {
    if (!intent?.visit_reason_code) return;

    setLoading(true);
    setBookingStatus(null);

    try {
      const resp = await postJSON<CreateHoldResponse>("/api/holds", {
        session_id: sessionId,
        provider_id: slot.provider_id,
        start: slot.start,
        mode: slot.mode,
        visit_reason_code: intent.visit_reason_code,
      });

      setSelectedSlot(slot);
      setHoldId(resp.hold_id);
      setHoldExpiresAt(resp.expires_at);
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          text: `Holding ${new Date(slot.start).toLocaleString()} with ${slot.provider_name}.`,
        },
      ]);
    } catch (e: unknown) {
      setBookingStatus(`Hold failed: ${getErrorMessage(e)}`);
    } finally {
      setLoading(false);
    }
  }

  async function bookAppointment() {
    if (!holdId || !selectedSlot) return;

    setLoading(true);
    setBookingStatus(null);

    try {
      const resp = await postJSON<BookAppointmentResponse>(
        "/api/appointments",
        {
          session_id: sessionId,
          hold_id: holdId,
          patient_first_name: patientFirstName,
          patient_last_name: patientLastName,
          patient_dob: patientDob,
          patient_phone: patientPhone,
          patient_email: patientEmail,
          notes: patientNotes || undefined,
        }
      );

      setBookingStatus(
        `Booked with ${resp.provider_name} on ${new Date(resp.start).toLocaleString()}.`
      );
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          text: `Booked ${resp.status} with ${resp.provider_name} (${resp.mode}). Confirmation: ${resp.appointment_id}.`,
        },
      ]);
    } catch (e: unknown) {
      setBookingStatus(`Booking failed: ${getErrorMessage(e)}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_20%_20%,#fff2e5,transparent_35%),radial-gradient(circle_at_80%_0,#ffe6cc,transparent_30%),#fffaf5] text-slate-900">
      <div className="mx-auto max-w-5xl px-4 py-8 lg:py-14">
        <header className="mb-8 flex items-center gap-3 rounded-2xl bg-white/80 p-4 shadow-md ring-1 ring-amber-100 backdrop-blur">
          <Image
            src="https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRCwaop_x0gpvZQwzpHV-2eDdxuja2PAQjqvQ&s"
            alt="Optum logo"
            width={120}
            height={48}
            className="h-12 w-auto"
          />
          <div>
            <div className="text-sm uppercase tracking-[0.14em] text-amber-700">Optum</div>
            <div className="text-xl font-semibold text-slate-900">Care Scheduling Assistant</div>
            <div className="text-sm text-slate-600">
              Personalized support to help you find the right care faster.
            </div>
          </div>
        </header>

        <div className="grid items-start gap-6 lg:grid-cols-[420px_1fr]">
          <div className="hidden lg:flex items-center justify-center">
            <div className="relative">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white shadow-lg">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-amber-500 to-orange-500 text-white text-xl font-semibold">
                  💬
                </div>
              </div>
              <span className="absolute -right-1 -top-1 h-4 w-4 rounded-full bg-red-500 border-2 border-white shadow" />
            </div>
          </div>

          {/* Chat */}
          <section className="relative overflow-hidden rounded-3xl bg-white shadow-2xl ring-1 ring-amber-100">
            <div className="bg-gradient-to-r from-amber-500 to-orange-500 px-6 py-4 text-white">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/20 text-lg font-semibold">
                  OC
                </div>
                <div className="flex-1">
                  <div className="text-sm opacity-90">We typically reply in a few minutes</div>
                  <div className="text-lg font-semibold">Optum Care Assistant</div>
                </div>
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/20">⌄</span>
              </div>
            </div>

            <div className="space-y-4 bg-gradient-to-b from-white via-white to-amber-50/60 px-6 py-5">
              <div className="flex items-center gap-2 text-sm text-slate-600">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                Online now • let us know how we can help
              </div>

              <div className="h-[460px] overflow-auto rounded-2xl border border-amber-100 bg-white/85 p-4 shadow-inner">
                {messages.map((m, i) => (
                  <div
                    key={i}
                    className={`mb-3 flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm shadow-sm ${
                        m.role === "user"
                          ? "bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-br-sm"
                          : m.role === "system"
                          ? "bg-amber-50 border border-amber-200 text-amber-900"
                          : "bg-white/95 border border-amber-50 text-slate-800"
                      }`}
                    >
                      {m.text}
                    </div>
                  </div>
                ))}
                {loading && (
                  <div className="text-sm text-slate-500">Thinking…</div>
                )}
              </div>

              <div className="flex items-center gap-3 rounded-full bg-white px-3 py-2 shadow-md ring-1 ring-amber-100">
                <input
                  className="flex-1 bg-transparent px-2 py-2 text-sm placeholder:text-slate-400 focus:outline-none"
                  placeholder="e.g. sore throat, rash, knee pain…"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSend()}
                />
                <button
                  className="flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-md transition hover:shadow-lg disabled:opacity-50"
                  onClick={handleSend}
                  disabled={loading}
                  aria-label="Send message"
                >
                  ➤
                </button>
              </div>

              <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.08em] text-slate-400">
                <span>Powered by Optum</span>
                <span className="text-amber-600">Trusted care</span>
              </div>
            </div>
          </section>

          {/* Results */}
          <section className="rounded-3xl bg-white/90 p-6 shadow-xl ring-1 ring-amber-100 backdrop-blur">
            <h2 className="mb-3 text-lg font-semibold text-slate-800">Next steps</h2>

            {!careOptions && (
              <p className="text-sm text-slate-600">
                Describe your issue to see care options tailored to you.
              </p>
            )}

            {careOptions && (
              <>
                <div className="mb-4 space-y-2 rounded-2xl border border-amber-100 bg-amber-50/60 p-4">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Care type
                  </div>
                  <div className="space-y-2 text-sm">
                    {careOptions.map((o) => (
                      <label
                        key={o.provider_type}
                        className="flex items-center justify-between rounded-xl bg-white px-3 py-2 ring-1 ring-slate-100"
                      >
                        <div>
                          <div className="font-medium text-slate-800">{o.label}</div>
                          {o.suggested && (
                            <div className="text-[11px] font-semibold uppercase text-emerald-600">
                              Suggested match
                            </div>
                          )}
                        </div>
                        <input
                          type="radio"
                          className="h-4 w-4 accent-amber-500"
                          checked={selectedCareType === o.provider_type}
                          onChange={() => setSelectedCareType(o.provider_type)}
                        />
                      </label>
                    ))}
                  </div>
                </div>

                <div className="mb-4 rounded-2xl border border-amber-100 bg-white p-4">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Visit mode
                  </div>
                  <div className="mt-2 flex flex-wrap gap-3 text-sm">
                    <label className="flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 ring-1 ring-amber-100">
                      <input
                        type="radio"
                        className="h-4 w-4 accent-amber-500"
                        checked={mode === "in_person"}
                        onChange={() => setMode("in_person")}
                      />
                      In person
                    </label>
                    <label className="flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 ring-1 ring-amber-100">
                      <input
                        type="radio"
                        className="h-4 w-4 accent-amber-500"
                        checked={mode === "virtual"}
                        onChange={() => setMode("virtual")}
                      />
                      Virtual
                    </label>
                  </div>
                </div>

                <button
                  className="mb-4 w-full rounded-2xl bg-gradient-to-r from-amber-500 to-orange-500 px-4 py-3 text-sm font-semibold text-white shadow-lg transition hover:shadow-xl disabled:opacity-50"
                  onClick={loadAvailability}
                  disabled={loading}
                >
                  Load availability
                </button>
              </>
            )}

            {availability && (
              <div className="max-h-80 space-y-3 overflow-auto rounded-2xl border border-slate-100 bg-white p-3">
                {availability.length === 0 && (
                  <p className="text-sm text-slate-600">
                    No slots available for that care type.
                  </p>
                )}

                {availability.slice(0, 20).map((s, i) => {
                  const isSelected =
                    selectedSlot?.start === s.start &&
                    selectedSlot?.provider_id === s.provider_id;
                  return (
                    <div
                      key={i}
                      className={`rounded-2xl border p-3 text-sm shadow-sm transition ${
                        isSelected
                          ? "border-amber-300 bg-amber-50"
                          : "border-slate-100 bg-slate-50"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <div className="font-semibold text-slate-800">
                            {new Date(s.start).toLocaleString()} ({s.mode.replace("_", " ")})
                          </div>
                          <div className="text-xs text-slate-500">
                            {s.provider_name} • {s.location_name}
                          </div>
                        </div>
                        <button
                          className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-amber-700 ring-1 ring-amber-200 transition hover:bg-amber-50 disabled:opacity-50"
                          onClick={() => holdSlot(s)}
                          disabled={loading}
                        >
                          {isSelected ? "Held" : "Hold this time"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {holdId && selectedSlot && (
              <div className="mt-4 space-y-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm shadow-inner">
                <div className="font-semibold text-emerald-800">
                  Holding {new Date(selectedSlot.start).toLocaleString()} with {selectedSlot.provider_name}
                </div>
                {holdExpiresAt && (
                  <div className="text-emerald-900">
                    Hold expires at {new Date(holdExpiresAt).toLocaleTimeString()}.
                  </div>
                )}

                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                    First name
                    <input
                      className="mt-1 w-full rounded-xl border border-white bg-white px-3 py-2 text-sm shadow-sm ring-1 ring-emerald-100 focus:outline-none"
                      value={patientFirstName}
                      onChange={(e) => setPatientFirstName(e.target.value)}
                    />
                  </label>
                  <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                    Last name
                    <input
                      className="mt-1 w-full rounded-xl border border-white bg-white px-3 py-2 text-sm shadow-sm ring-1 ring-emerald-100 focus:outline-none"
                      value={patientLastName}
                      onChange={(e) => setPatientLastName(e.target.value)}
                    />
                  </label>
                  <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                    Date of birth
                    <input
                      className="mt-1 w-full rounded-xl border border-white bg-white px-3 py-2 text-sm shadow-sm ring-1 ring-emerald-100 focus:outline-none"
                      type="date"
                      value={patientDob}
                      onChange={(e) => setPatientDob(e.target.value)}
                    />
                  </label>
                  <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                    Phone
                    <input
                      className="mt-1 w-full rounded-xl border border-white bg-white px-3 py-2 text-sm shadow-sm ring-1 ring-emerald-100 focus:outline-none"
                      value={patientPhone}
                      onChange={(e) => setPatientPhone(e.target.value)}
                    />
                  </label>
                  <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                    Email (optional)
                    <input
                      className="mt-1 w-full rounded-xl border border-white bg-white px-3 py-2 text-sm shadow-sm ring-1 ring-emerald-100 focus:outline-none"
                      type="email"
                      value={patientEmail}
                      onChange={(e) => setPatientEmail(e.target.value)}
                    />
                  </label>
                  <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-600 md:col-span-2">
                    Notes
                    <textarea
                      className="mt-1 w-full rounded-xl border border-white bg-white px-3 py-2 text-sm shadow-sm ring-1 ring-emerald-100 focus:outline-none"
                      rows={2}
                      value={patientNotes}
                      onChange={(e) => setPatientNotes(e.target.value)}
                    />
                  </label>
                </div>

                <button
                  className="w-full rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white shadow-lg transition hover:shadow-xl disabled:opacity-50"
                  onClick={bookAppointment}
                  disabled={loading}
                >
                  Book appointment
                </button>

                {bookingStatus && (
                  <div className="text-sm text-emerald-900">{bookingStatus}</div>
                )}
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
