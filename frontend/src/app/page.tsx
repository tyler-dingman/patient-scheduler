"use client";

import Image from "next/image";
import React, { useCallback, useEffect, useRef, useState } from "react";

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
    | "cardiology"
    | "neurology"
    | null;
  confidence?: string | null;
  follow_up_questions?: string[];
};

type ProviderType =
  | "primary_care"
  | "urgent_care"
  | "dermatology"
  | "orthopedics"
  | "cardiology"
  | "neurology";

type ProviderSummary = {
  provider_id: string;
  name: string;
  provider_type: ProviderType;
  accepts_virtual: boolean;
  location_name: string;
  location_city: string;
  location_state: string;
  next_available_start?: string | null;
  next_available_mode?: "in_person" | "virtual" | null;
};

type ProvidersResponse = { providers: ProviderSummary[] };
type ProviderSearchResponse = {
  providers: ProviderSummary[];
  suggestions: ProviderSummary[];
};

type AppointmentSlot = {
  iso: string;
  label: string;
  mode: "in_person" | "virtual";
};

type ProviderDiscoveryContext = {
  providerType: ProviderType;
  locationLabel: string;
  title?: string;
};

type Msg = {
  role: Role;
  text: string;
  kind?: "text" | "providers" | "appointment_overview";
};

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE ?? "http://127.0.0.1:8000";

function providerInitials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n[0])
    .join("")
    .toUpperCase();
}

function formatSpecialty(type: ProviderType) {
  switch (type) {
    case "primary_care":
      return "Primary Care";
    case "urgent_care":
      return "Urgent Care";
    case "dermatology":
      return "Dermatology";
    case "orthopedics":
      return "Orthopedics";
    case "cardiology":
      return "Cardiology";
    case "neurology":
      return "Neurology";
    default:
      return "Provider";
  }
}

function buildSlots(provider: ProviderSummary): AppointmentSlot[] {
  const base = provider.next_available_start
    ? new Date(provider.next_available_start)
    : new Date(Date.now() + 60 * 60 * 1000);

  const mode =
    provider.next_available_mode ?? (provider.accepts_virtual ? "virtual" : "in_person");

  return [0, 30, 60, 90].map((minuteOffset) => {
    const slotDate = new Date(base.getTime() + minuteOffset * 60 * 1000);
    const label = slotDate.toLocaleString(undefined, {
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
    });

    return {
      iso: slotDate.toISOString(),
      label,
      mode,
    };
  });
}

function detectUrgency(text: string): "urgent" | "routine" | null {
  const normalized = text.toLowerCase();
  if (
    normalized.includes("urgent") ||
    normalized.includes("asap") ||
    normalized.includes("right away") ||
    normalized.includes("today")
  ) {
    return "urgent";
  }

  if (
    normalized.includes("non-urgent") ||
    normalized.includes("not urgent") ||
    normalized.includes("routine") ||
    normalized.includes("checkup")
  ) {
    return "routine";
  }

  return null;
}

function detectModePreference(text: string): "virtual" | "in_person" | null {
  const normalized = text.toLowerCase();
  if (normalized.includes("virtual") || normalized.includes("telehealth")) {
    return "virtual";
  }

  if (
    normalized.includes("in person") ||
    normalized.includes("in-person") ||
    normalized.includes("clinic")
  ) {
    return "in_person";
  }

  return null;
}

function detectPatientGroup(text: string): "pediatric" | "adult" | null {
  const normalized = text.toLowerCase();
  if (
    normalized.includes("child") ||
    normalized.includes("kid") ||
    normalized.includes("son") ||
    normalized.includes("daughter") ||
    normalized.includes("pediatric")
  ) {
    return "pediatric";
  }

  if (normalized.includes("adult")) {
    return "adult";
  }

  return null;
}

export default function Page() {
  const [sessionId] = useState(
    () => "sess_" + Math.random().toString(16).slice(2)
  );
  const [messages, setMessages] = useState<Msg[]>([]);

  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  const [mode] = useState<"in_person" | "virtual">("in_person");

  const [providerMatches, setProviderMatches] = useState<ProviderSummary[] | null>(
    null
  );
  const [providerDiscoveryMode, setProviderDiscoveryMode] = useState<
    "idle" | "finding"
  >("idle");
  const [providerDiscoveryContext, setProviderDiscoveryContext] = useState<
    ProviderDiscoveryContext | null
  >(null);
  const [searchSuggestions, setSearchSuggestions] =
    useState<ProviderSearchResponse | null>(null);
  const [lastSuggestionQuery, setLastSuggestionQuery] = useState<string>("");

  const [insuranceFlowActive, setInsuranceFlowActive] = useState(false);
  const [insuranceFilter, setInsuranceFilter] = useState("");
  const [selectedInsurance, setSelectedInsurance] = useState<string | null>(
    null
  );

  const [selectedAppointment, setSelectedAppointment] = useState<{
    provider: ProviderSummary;
    slot: AppointmentSlot;
  } | null>(null);

  const [symptomFlowActive, setSymptomFlowActive] = useState(false);
  const [symptomStep, setSymptomStep] = useState(0);
  const [symptomResponses, setSymptomResponses] = useState<
    Record<string, string>
  >({});
  const [geoStatus, setGeoStatus] = useState<
    "idle" | "locating" | "granted" | "denied"
  >("idle");
  const [userLocation, setUserLocation] = useState<string | null>(null);
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  const scrollAnchorRef = useRef<HTMLDivElement | null>(null);

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

  useEffect(() => {
    const query = input.trim();

    if (query.length < 3 || !looksLikeProviderName(query)) {
      setSearchSuggestions(null);
      setLastSuggestionQuery("");
      return;
    }

    let cancelled = false;
    const handle = setTimeout(async () => {
      if (cancelled) return;
      try {
        const resp = await getJSON<ProviderSearchResponse>(
          `/api/provider-search?q=${encodeURIComponent(query)}&limit=3&mode=${mode}`
        );
        if (cancelled) return;
        if (query !== input.trim()) return;
        setSearchSuggestions(resp);
        setLastSuggestionQuery(query);
      } catch {
        if (!cancelled) {
          setSearchSuggestions(null);
        }
      }
    }, 200);

    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [input, mode]);

  const quickPrompts = [
    "Find a primary care provider near me",
    "Find a cardiologist near me",
    "Find a neurologist near me",
    "What’s the earliest available appointment?",
    "Which doctors accept my insurance?",
  ];

  const insurancePlans = [
    { name: "UnitedHealthcare", shorthand: "UHC", color: "#0c4ea3" },
    { name: "Wellmark Blue Cross Blue Shield", shorthand: "BCBS", color: "#0072ce" },
    { name: "Anthem Blue Cross Blue Shield", shorthand: "Anthem", color: "#1654b5" },
    { name: "Aetna", shorthand: "Aetna", color: "#7f1d7c" },
    { name: "Cigna", shorthand: "Cigna", color: "#0099cc" },
    { name: "Wellpoint (formerly Amerigroup)", shorthand: "Wellpoint", color: "#0056b3" },
    { name: "Medicaid", shorthand: "Medicaid", color: "#0f766e" },
  ];

  const symptomQuestions = [
    {
      id: "duration",
      question: "How long has the sore throat lasted?",
      options: ["Less than a day", "1-3 days", "More than 3 days"],
    },
    {
      id: "fever",
      question: "Is there a fever present?",
      options: ["No fever", "Mild fever", "High fever"],
    },
    {
      id: "breathing",
      question: "Any trouble breathing or swallowing?",
      options: ["No", "Mild discomfort", "Yes, significant"],
    },
  ];

  useEffect(() => {
    if (!symptomFlowActive || geoStatus !== "idle") return;

    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setGeoStatus("denied");
      return;
    }

    setGeoStatus("locating");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const coords = `${pos.coords.latitude.toFixed(3)}, ${pos.coords.longitude.toFixed(3)}`;
        setUserLocation(coords);
        setGeoStatus("granted");
      },
      () => setGeoStatus("denied")
    );
  }, [symptomFlowActive, geoStatus]);

  function resetFlows() {
    setInsuranceFlowActive(false);
    setInsuranceFilter("");
    setSelectedInsurance(null);
    setSymptomFlowActive(false);
    setSymptomStep(0);
    setSymptomResponses({});
    setGeoStatus("idle");
    setUserLocation(null);
    setProviderMatches(null);
    setProviderDiscoveryMode("idle");
    setProviderDiscoveryContext(null);
    setSearchSuggestions(null);
    setLastSuggestionQuery("");
  }

  function isInsuranceQuery(text: string) {
    const normalized = text.toLowerCase();
    const mentionsInsurance =
      normalized.includes("insurance") ||
      normalized.includes("coverage") ||
      normalized.includes("plan");
    const mentionsDoctor =
      normalized.includes("doctor") ||
      normalized.includes("provider") ||
      normalized.includes("accept") ||
      normalized.includes("which doctors");

    return mentionsInsurance && mentionsDoctor;
  }

  function isSymptomQuery(text: string) {
    const normalized = text.toLowerCase();
    return normalized.includes("sore throat") || normalized.includes("symptom checker");
  }

  function normalizeLocationLabel(text: string) {
    const normalized = text.toLowerCase();
    if (
      normalized.includes("near me") ||
      normalized.includes("nearby") ||
      normalized.includes("around here") ||
      normalized.includes("close to me")
    ) {
      return "near you";
    }

    const locationMatch = text.match(
      /\b(?:in|near|around)\s+([A-Za-z][A-Za-z\s]{2,})/i
    );
    if (locationMatch?.[1]) {
      const place = locationMatch[1].trim();
      if (place.length > 0) {
        return `near ${place}`;
      }
    }

    return null;
  }

  function detectProviderSearch(text: string) {
    const normalized = text.toLowerCase();
    const specialties: {
      providerType: ProviderType;
      keywords: string[];
    }[] = [
      {
        providerType: "cardiology",
        keywords: ["cardiologist", "cardiology", "heart doctor", "heart specialist"],
      },
      {
        providerType: "neurology",
        keywords: ["neurologist", "neurology", "brain doctor", "nerve"],
      },
      {
        providerType: "primary_care",
        keywords: ["primary care", "pcp", "family doctor", "family medicine"],
      },
      {
        providerType: "urgent_care",
        keywords: ["urgent care", "walk-in", "same-day"],
      },
      {
        providerType: "dermatology",
        keywords: ["dermatology", "dermatologist", "skin doctor"],
      },
      {
        providerType: "orthopedics",
        keywords: ["orthopedic", "orthopedics", "orthopedist", "joint doctor"],
      },
    ];

    for (const specialty of specialties) {
      if (specialty.keywords.some((k) => normalized.includes(k))) {
        const locationLabel = normalizeLocationLabel(text) ?? "near you";
        return { providerType: specialty.providerType, locationLabel };
      }
    }

    return null;
  }

  function looksLikeProviderName(text: string) {
    const normalized = text.trim();
    if (normalized.length < 3 || normalized.length > 120) return false;

    const words = normalized.split(/\s+/);
    if (words.length === 0 || words.length > 3) return false;

    const isNameWord = (word: string) => /^[A-Za-z][A-Za-z.'-]*$/.test(word);

    if (words.length === 3) {
      if (words[0].toLowerCase() !== "dr") return false;
      return isNameWord(words[1]) && isNameWord(words[2]);
    }

    if (words.length === 2) {
      return words.every(isNameWord);
    }

    return isNameWord(words[0]);
  }

  function isNextAvailableRequest(text: string) {
    const normalized = text.toLowerCase();
    return (
      normalized.includes("next available") ||
      normalized.includes("earliest available") ||
      normalized.includes("soonest") ||
      normalized.includes("first available")
    );
  }

  const fetchProvidersByType = useCallback(
    async (
      providerType: ProviderType,
      query?: string,
      locationLabel: string = "near you",
      intent?: "next_available" | "insurance_filter"
    ) => {
      setProviderDiscoveryMode("finding");
      setProviderMatches(null);
      setProviderDiscoveryContext({ providerType, locationLabel });

      try {
        const resp = await getJSON<ProvidersResponse>(
          `/api/providers?provider_type=${providerType}&limit=4&mode=${mode}`
        );

        setProviderMatches(resp.providers);
        const specialtyLabel = formatSpecialty(providerType).toLowerCase();
        const intro =
          intent === "insurance_filter"
            ? `Here are ${specialtyLabel} options ${locationLabel} that accept ${
                query ?? "your insurance"
              }.`
            : intent === "next_available"
            ? `Here are the next available ${specialtyLabel} appointments ${
                locationLabel
              }${query ? ` for "${query}".` : "."}`
            : `Sure — here are ${specialtyLabel} options ${locationLabel}${
                query ? ` based on "${query}".` : "."
              }`;

        setMessages((m) => [
          ...m,
          { role: "assistant", text: intro, kind: "text" },
          { role: "assistant", text: "", kind: "providers" },
        ]);
      } catch (e: unknown) {
        setMessages((m) => [
          ...m,
          { role: "assistant", text: `Error: ${getErrorMessage(e)}` },
        ]);
      } finally {
        setLoading(false);
        setProviderDiscoveryMode("idle");
      }
    },
    [mode]
  );

  const fetchProvidersByName = useCallback(
    async (query: string) => {
      setProviderDiscoveryMode("finding");
      setProviderMatches(null);

      try {
        const resp = await getJSON<ProviderSearchResponse>(
          `/api/provider-search?q=${encodeURIComponent(query)}&limit=4&mode=${mode}`
        );

        const matches =
          resp.providers.length > 0 ? resp.providers : resp.suggestions;

        if (matches.length === 0) {
          setMessages((m) => [
            ...m,
            {
              role: "assistant",
              text: `I couldn't find any providers matching "${query}". Try another name or add more details.`,
            },
          ]);
          return true;
        }

        const title =
          resp.providers.length > 0 ? "Matching providers" : "Suggested providers";
        const label =
          resp.providers.length > 0
            ? `for "${query}"`
            : `for names similar to "${query}"`;

        setProviderMatches(matches);
        setProviderDiscoveryContext({
          providerType: matches[0]?.provider_type ?? "primary_care",
          locationLabel: label,
          title,
        });

        const intro =
          resp.providers.length > 0
            ? `Here are providers matching "${query}".`
            : `No exact match for "${query}" — showing similar provider names.`;

        setMessages((m) => [
          ...m,
          { role: "assistant", text: intro, kind: "text" },
          { role: "assistant", text: "", kind: "providers" },
        ]);
        return true;
      } catch (e: unknown) {
        setMessages((m) => [
          ...m,
          { role: "assistant", text: `Error: ${getErrorMessage(e)}` },
        ]);
        return false;
      } finally {
        setLoading(false);
        setProviderDiscoveryMode("idle");
      }
    },
    [mode]
  );

  function handleSlotSelect(provider: ProviderSummary, slot: AppointmentSlot) {
    setSelectedAppointment({ provider, slot });

    setMessages((m) => {
      const hasOverview = m.some((msg) => msg.kind === "appointment_overview");
      if (hasOverview) return m;
      return [...m, { role: "assistant", text: "", kind: "appointment_overview" }];
    });
  }

  function handleInsuranceSelect(planName: string) {
    setSelectedInsurance(planName);

    const providerType = providerDiscoveryContext?.providerType ?? "primary_care";
    const locationLabel = providerDiscoveryContext?.locationLabel ?? "near you";

    setMessages((m) => [
      ...m,
      {
        role: "assistant",
        text: `Great — showing ${formatSpecialty(providerType).toLowerCase()} providers ${locationLabel} who accept ${planName}.`,
      },
    ]);

    fetchProvidersByType(
      providerType,
      planName,
      locationLabel,
      "insurance_filter"
    );
  }

  function confirmSelectedAppointment() {
    if (!selectedAppointment) return;

    const { provider, slot } = selectedAppointment;

    setMessages((m) => [
      ...m,
      {
        role: "assistant",
        text: `Your ${slot.mode === "virtual" ? "virtual" : "in-person"} visit with ${
          provider.name
        } is set for ${slot.label}. I’ll share confirmation details shortly.`,
      },
    ]);

    setSelectedAppointment(null);
  }

  function answerSymptomQuestion(option: string) {
    const current = symptomQuestions[symptomStep];
    if (!current) return;

    setSymptomResponses((prev) => ({ ...prev, [current.id]: option }));
    const nextStep = symptomStep + 1;

    if (nextStep >= symptomQuestions.length) {
      setSymptomStep(nextStep);
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          text: `Thanks for the details. I’ll check urgent care times ${
            userLocation ? `near ${userLocation}` : "near you"
          }.`,
        },
      ]);
    } else {
      setSymptomStep(nextStep);
    }
  }

  async function handleSend(customText?: string) {
    const raw = customText ?? input;
    if (!raw.trim()) return;

    const text = raw.trim();
    if (!customText) {
      setInput("");
    }
    resetFlows();

    setMessages((m) => [...m, { role: "user", text }]);
    setLoading(true);

    if (isInsuranceQuery(text)) {
      setLoading(false);
      setInsuranceFlowActive(true);
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          text: "I can help find doctors who accept your insurance. Choose a popular plan below or start typing your carrier.",
        },
      ]);
      return;
    }

    if (looksLikeProviderName(text)) {
      const handled = await fetchProvidersByName(text);
      if (handled) return;
    }

    const providerIntent = detectProviderSearch(text);
    const wantsNextAvailable = isNextAvailableRequest(text);
    const inferredLocation =
      providerIntent?.locationLabel || normalizeLocationLabel(text) || "near you";

    if (providerIntent || wantsNextAvailable) {
      const providerType = providerIntent?.providerType ?? "primary_care";
      await fetchProvidersByType(
        providerType,
        text,
        inferredLocation,
        wantsNextAvailable ? "next_available" : undefined
      );
      return;
    }

    if (isSymptomQuery(text)) {
      setLoading(false);
      setSymptomFlowActive(true);
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          text: "Let’s run a quick symptom check to match an urgent care slot and geolocate you automatically.",
        },
      ]);
      return;
    }

    const urgency = detectUrgency(text);
    const modePreference = detectModePreference(text);
    const patientGroup = detectPatientGroup(text);

    try {
      const intentResp = await postJSON<SearchIntentResponse>("/api/search-intent", {
        session_id: sessionId,
        message: text,
        mode_preference: mode,
      });

      if (intentResp.escalate) {
        setMessages((m) => [
          ...m,
          {
            role: "assistant",
            text:
              intentResp.safety_message ??
              "For safety, please call 911 or visit the nearest emergency room.",
          },
        ]);
        return;
      }

      const reasonLabel = intentResp.visit_reason_label ?? "your request";
      const providerLabel = intentResp.recommended_provider_type
        ? formatSpecialty(intentResp.recommended_provider_type as ProviderType)
        : "care";

      const affirmations = [
        `I can help with ${reasonLabel}.`,
        intentResp.recommended_provider_type
          ? `Most patients start with ${providerLabel.toLowerCase()} for this.`
          : null,
      ].filter(Boolean);

      const primarySignals = [
        patientGroup === "pediatric"
          ? "I'll look for pediatric-friendly options."
          : null,
        modePreference === "virtual"
          ? "I'll focus on virtual visits."
          : modePreference === "in_person"
          ? "I'll focus on in-person visits."
          : null,
        urgency === "urgent"
          ? "Sounds urgent—I'll prioritize today or soon."
          : urgency === "routine"
          ? "Sounds routine—I'll find the next available times."
          : null,
      ].filter(Boolean);

      const schedulingPrompt = wantsNextAvailable
        ? `I'll pull the earliest available appointments ${inferredLocation}.`
        : `Want me to show the soonest available appointments ${inferredLocation}?`;

      const followUps: string[] = [];
      if (!modePreference) {
        followUps.push("Do you prefer in-person or virtual?");
      }
      if (!urgency) {
        followUps.push("Is this urgent (today/soon) or routine?");
      }
      if (!patientGroup) {
        followUps.push("Is this for an adult or child?");
      }
      if (intentResp.follow_up_questions?.length) {
        followUps.push(...intentResp.follow_up_questions);
      }

      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          text: [...affirmations, ...primarySignals, schedulingPrompt].join(" "),
        },
      ]);

      if (followUps.length > 0) {
        setMessages((m) => [
          ...m,
          ...followUps.map((q) => ({ role: "assistant", text: q })),
        ]);
      }
    } catch (e: unknown) {
      setMessages((m) => [
        ...m,
        { role: "assistant", text: `Error: ${getErrorMessage(e)}` },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function handleVoiceChat() {
    setMessages((prev) => [
      ...prev,
      {
        role: "system",
        text: "Voice chat is getting ready.",
      },
    ]);
  }

  const filteredInsurancePlans = insurancePlans.filter((plan) =>
    plan.name.toLowerCase().includes(insuranceFilter.toLowerCase())
  );

  const symptomComplete = symptomStep >= symptomQuestions.length;
  const geoStatusLabel =
    geoStatus === "locating"
      ? "Locating you…"
      : geoStatus === "granted"
      ? userLocation
        ? `Using location: ${userLocation}`
        : "Location confirmed"
      : geoStatus === "denied"
      ? "Location not shared"
      : "Auto-location ready";

  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    container.scrollTo({
      top: container.scrollHeight,
      behavior: "smooth",
    });

    scrollAnchorRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const providerLocationLabel =
    providerDiscoveryContext?.locationLabel ?? "near you";
  const providerSpecialtyLabel = providerDiscoveryContext
    ? providerDiscoveryContext.title ??
      formatSpecialty(providerDiscoveryContext.providerType)
    : "Providers";

  return (
    <main className="relative min-h-screen bg-[#f58220] px-4 py-6 text-slate-900 lg:py-10">

      <section className="relative mx-auto flex max-h-[92vh] max-w-[50rem] flex-col overflow-hidden rounded-[32px] border border-[#f58220]/25 bg-white/95 shadow-2xl ring-1 ring-[#f58220]/25 lg:max-h-[90vh]">
        <div className="flex-1 space-y-5 overflow-y-auto">
          <div className="relative flex flex-1 flex-col overflow-hidden bg-white px-5 pb-5 pt-4 lg:p-7">
            <div className="mb-4 flex items-center gap-4 rounded-2xl bg-white px-4 py-4 shadow-sm ring-1 ring-slate-200">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white ring-1 ring-[#f58220]/20">
                <Image
                  src="/optum-o.svg"
                  alt="Optum O logo"
                  width={40}
                  height={40}
                  className="h-10 w-10"
                  priority
                />
              </div>
              <div className="flex flex-col">
                <div className="text-xl font-semibold leading-snug text-slate-900">
                  Optum Companion
                </div>
                <div className="text-lg text-slate-600">
                  Hi, I’m here to help you find care.
                </div>
              </div>
            </div>

            <div className="mt-1 flex flex-wrap gap-2">
              {quickPrompts.map((prompt) => (
                <button
                  key={prompt}
                  className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-800 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md disabled:opacity-60"
                  onClick={() => handleSend(prompt)}
                  disabled={loading}
                >
                  {prompt}
                </button>
              ))}
            </div>

            <div className="flex-1" />
          </div>

        </div>

      </section>
    </main>
  );
}
