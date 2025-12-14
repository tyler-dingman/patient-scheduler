"use client";

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
    <main className="min-h-screen bg-white text-black p-6">
      <div className="mx-auto max-w-4xl grid gap-6 md:grid-cols-2">
        {/* Chat */}
        <section className="bg-white rounded-xl shadow p-4">
          <h1 className="text-xl font-semibold mb-2">
            Patient Scheduling Demo
          </h1>

          <div className="h-[420px] overflow-auto border rounded p-3 mb-3 bg-gray-50">
            {messages.map((m, i) => (
              <div
                key={i}
                className={`mb-2 ${
                  m.role === "user" ? "text-right" : ""
                }`}
              >
                <span
                  className={`inline-block rounded px-3 py-2 text-sm ${
                    m.role === "user"
                      ? "bg-blue-600 text-white"
                      : m.role === "system"
                      ? "bg-yellow-100"
                      : "bg-white border"
                  }`}
                >
                  {m.text}
                </span>
              </div>
            ))}
            {loading && (
              <div className="text-sm text-gray-500">
                Thinking…
              </div>
            )}
          </div>

          <div className="flex gap-2">
            <input
              className="flex-1 border rounded px-3 py-2 text-sm"
              placeholder="e.g. sore throat, rash, knee pain…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSend()}
            />
            <button
              className="bg-blue-600 text-white rounded px-4 py-2 text-sm"
              onClick={handleSend}
              disabled={loading}
            >
              Send
            </button>
          </div>
        </section>

        {/* Results */}
        <section className="bg-white rounded-xl shadow p-4">
          <h2 className="font-medium mb-2">Next steps</h2>

          {!careOptions && (
            <p className="text-sm text-gray-600">
              Describe your issue to see options.
            </p>
          )}

          {careOptions && (
            <>
              <div className="mb-3">
                <div className="font-medium mb-1">
                  Care type
                </div>
                {careOptions.map((o) => (
                  <label
                    key={o.provider_type}
                    className="block text-sm"
                  >
                    <input
                      type="radio"
                      className="mr-2"
                      checked={
                        selectedCareType === o.provider_type
                      }
                      onChange={() =>
                        setSelectedCareType(o.provider_type)
                      }
                    />
                    {o.label}{" "}
                    {o.suggested && (
                      <span className="text-green-700 text-xs">
                        (suggested)
                      </span>
                    )}
                  </label>
                ))}
              </div>

              <div className="mb-3">
                <div className="font-medium mb-1">Visit mode</div>
                <label className="mr-4 text-sm">
                  <input
                    type="radio"
                    className="mr-2"
                    checked={mode === "in_person"}
                    onChange={() => setMode("in_person")}
                  />
                  In person
                </label>
                <label className="text-sm">
                  <input
                    type="radio"
                    className="mr-2"
                    checked={mode === "virtual"}
                    onChange={() => setMode("virtual")}
                  />
                  Virtual
                </label>
              </div>

              <button
                className="w-full bg-gray-900 text-white rounded px-3 py-2 text-sm mb-3"
                onClick={loadAvailability}
                disabled={loading}
              >
                Load availability
              </button>
            </>
          )}

          {availability && (
            <div className="max-h-72 overflow-auto">
              {availability.length === 0 && (
                <p className="text-sm text-gray-600">
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
                    className={`border rounded p-2 mb-2 text-sm ${
                      isSelected ? "bg-blue-50 border-blue-400" : "bg-gray-50"
                    }`}
                  >
                    <div className="font-medium">
                      {new Date(s.start).toLocaleString()} ({s.mode.replace("_", " ")})
                    </div>
                    <div className="text-gray-600">
                      {s.provider_name} • {s.location_name}
                    </div>
                    <button
                      className="mt-2 inline-flex items-center rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white"
                      onClick={() => holdSlot(s)}
                      disabled={loading}
                    >
                      {isSelected ? "Held" : "Hold this time"}
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {holdId && selectedSlot && (
            <div className="mt-3 border rounded p-3 bg-green-50 text-sm space-y-2">
              <div className="font-medium text-green-800">
                Holding {new Date(selectedSlot.start).toLocaleString()} with {selectedSlot.provider_name}
              </div>
              {holdExpiresAt && (
                <div className="text-green-900">
                  Hold expires at {new Date(holdExpiresAt).toLocaleTimeString()}.
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <label className="text-xs uppercase text-gray-600">
                  First name
                  <input
                    className="w-full border rounded px-2 py-1 text-sm"
                    value={patientFirstName}
                    onChange={(e) => setPatientFirstName(e.target.value)}
                  />
                </label>
                <label className="text-xs uppercase text-gray-600">
                  Last name
                  <input
                    className="w-full border rounded px-2 py-1 text-sm"
                    value={patientLastName}
                    onChange={(e) => setPatientLastName(e.target.value)}
                  />
                </label>
                <label className="text-xs uppercase text-gray-600">
                  Date of birth
                  <input
                    className="w-full border rounded px-2 py-1 text-sm"
                    type="date"
                    value={patientDob}
                    onChange={(e) => setPatientDob(e.target.value)}
                  />
                </label>
                <label className="text-xs uppercase text-gray-600">
                  Phone
                  <input
                    className="w-full border rounded px-2 py-1 text-sm"
                    value={patientPhone}
                    onChange={(e) => setPatientPhone(e.target.value)}
                  />
                </label>
                <label className="text-xs uppercase text-gray-600">
                  Email (optional)
                  <input
                    className="w-full border rounded px-2 py-1 text-sm"
                    type="email"
                    value={patientEmail}
                    onChange={(e) => setPatientEmail(e.target.value)}
                  />
                </label>
                <label className="text-xs uppercase text-gray-600 md:col-span-2">
                  Notes
                  <textarea
                    className="w-full border rounded px-2 py-1 text-sm"
                    rows={2}
                    value={patientNotes}
                    onChange={(e) => setPatientNotes(e.target.value)}
                  />
                </label>
              </div>

              <button
                className="w-full rounded bg-emerald-700 px-3 py-2 text-sm font-medium text-white"
                onClick={bookAppointment}
                disabled={loading}
              >
                Book appointment
              </button>

              {bookingStatus && (
                <div className="text-sm text-green-900">{bookingStatus}</div>
              )}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
