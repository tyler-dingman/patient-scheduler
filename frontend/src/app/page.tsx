"use client";

import React, { useMemo, useState } from "react";

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

  const suggestedCare = useMemo(
    () => careOptions?.find((o) => o.suggested)?.provider_type ?? null,
    [careOptions]
  );

  async function postJSON<T>(path: string, body: any): Promise<T> {
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
    setCareOptions(null);
    setSelectedCareType(null);
    setIntent(null);

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
    } catch (e: any) {
      setMessages((m) => [
        ...m,
        { role: "assistant", text: `Error: ${e.message}` },
      ]);
    } finally {
      setLoading(false);
    }
  }

  async function loadAvailability() {
    if (!selectedCareType || !intent?.visit_reason_code) return;

    setLoading(true);
    try {
      const resp = await getJSON<AvailabilityResponse>(
        `/api/availability?provider_type=${selectedCareType}&start_date=${todayISO()}&days=7&mode=${mode}&visit_reason_code=${intent.visit_reason_code}`
      );
      setAvailability(resp.slots);
    } catch (e: any) {
      setMessages((m) => [
        ...m,
        { role: "assistant", text: e.message },
      ]);
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
              {availability.slice(0, 20).map((s, i) => (
                <div
                  key={i}
                  className="border rounded p-2 mb-2 text-sm bg-gray-50"
                >
                  <div className="font-medium">
                    {new Date(s.start).toLocaleString()}
                  </div>
                  <div className="text-gray-600">
                    {s.provider_name} • {s.location_name}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
