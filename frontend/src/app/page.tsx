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
  kind?:
    | "text"
    | "providers"
    | "appointment_overview"
    | "insurance_filter"
    | "success";
  options?: string[];
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

  const stateAbbreviations: Record<string, string> = {
    Alabama: "AL",
    Alaska: "AK",
    Arizona: "AZ",
    Arkansas: "AR",
    California: "CA",
    Colorado: "CO",
    Connecticut: "CT",
    Delaware: "DE",
    Florida: "FL",
    Georgia: "GA",
    Hawaii: "HI",
    Idaho: "ID",
    Illinois: "IL",
    Indiana: "IN",
    Iowa: "IA",
    Kansas: "KS",
    Kentucky: "KY",
    Louisiana: "LA",
    Maine: "ME",
    Maryland: "MD",
    Massachusetts: "MA",
    Michigan: "MI",
    Minnesota: "MN",
    Mississippi: "MS",
    Missouri: "MO",
    Montana: "MT",
    Nebraska: "NE",
    Nevada: "NV",
    "New Hampshire": "NH",
    "New Jersey": "NJ",
    "New Mexico": "NM",
    "New York": "NY",
    "North Carolina": "NC",
    "North Dakota": "ND",
    Ohio: "OH",
    Oklahoma: "OK",
    Oregon: "OR",
    Pennsylvania: "PA",
    "Rhode Island": "RI",
    "South Carolina": "SC",
    "South Dakota": "SD",
    Tennessee: "TN",
    Texas: "TX",
    Utah: "UT",
    Vermont: "VT",
    Virginia: "VA",
    Washington: "WA",
    "West Virginia": "WV",
    Wisconsin: "WI",
    Wyoming: "WY",
    "District of Columbia": "DC",
  };

  function formatState(state?: string) {
    if (!state) return null;
    return stateAbbreviations[state] ?? state;
  }

  async function reverseGeocode(lat: number, lon: number) {
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=10&addressdetails=1`,
        {
          headers: {
            "Accept-Language": "en",
          },
        }
      );

      if (!response.ok) {
        throw new Error("Failed to reverse geocode location");
      }

      const data = await response.json();
      const address = data.address ?? {};

      const city =
        address.city ||
        address.town ||
        address.village ||
        address.hamlet ||
        address.municipality ||
        address.county;

      const state = formatState(address.state);

      if (city && state) return `${city}, ${state}`;
      if (city) return city;
      if (state) return state;

      return `${lat.toFixed(3)}, ${lon.toFixed(3)}`;
    } catch (error) {
      console.error("Reverse geocoding failed", error);
      return `${lat.toFixed(3)}, ${lon.toFixed(3)}`;
    }
  }

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

  const insuranceCareSuggestions = [
    "Primary Care",
    "Urgent Care",
    "Pediatrics",
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
        const { latitude, longitude } = pos.coords;
        reverseGeocode(latitude, longitude).then((label) => {
          setUserLocation(label);
          setGeoStatus("granted");
        });
      },
      () => setGeoStatus("denied")
    );
  }, [symptomFlowActive, geoStatus]);

  function resetFlows() {
    setInsuranceFlowActive(false);
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

    setMessages((m) => [
      ...m,
      {
        role: "assistant",
        text: `Great — I'll use ${planName}. Now that I know your insurance, what type of care are you looking for?`,
        options: insuranceCareSuggestions,
      },
    ]);
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
        kind: "success",
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
      setSelectedInsurance(null);
      setInsuranceFlowActive(true);
      setMessages((m) => {
        const withoutInsuranceFilter = m.filter(
          (msg) => msg.kind !== "insurance_filter"
        );

        return [
          ...withoutInsuranceFilter,
          {
            role: "assistant",
            text: "I can help find doctors who accept your insurance. Pick your plan from the list below to continue.",
          },
          { role: "assistant", text: "", kind: "insurance_filter" },
        ];
      });
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
        : `I recommend showing the soonest available appointments ${inferredLocation}.`;

      type FollowUp = { text: string; options: string[] };
      const followUps: FollowUp[] = [];
      if (!modePreference) {
        followUps.push({
          text: "Choose a visit format so I can tailor the schedule.",
          options: ["In-person", "Virtual"],
        });
      }
      if (!urgency) {
        followUps.push({
          text: "Pick how soon you’d like care.",
          options: ["Today or soon", "Routine"],
        });
      }
      if (!patientGroup) {
        followUps.push({
          text: "Select who the visit is for.",
          options: ["Adult", "Child"],
        });
      }
      if (intentResp.follow_up_questions?.length) {
        followUps.push(
          ...intentResp.follow_up_questions.map((q) => ({
            text: q,
            options: ["Share details", "Skip for now"],
          }))
        );
      }

      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          text: [...affirmations, ...primarySignals, schedulingPrompt].join(" "),
        },
      ]);

      if (followUps.length > 0) {
        const nextFollowUp = followUps[0];
        setMessages((m) => [
          ...m,
          { role: "assistant", text: nextFollowUp.text, options: nextFollowUp.options },
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
          <div className="relative flex flex-1 flex-col overflow-hidden bg-gradient-to-b from-white via-[#f58220]/10 to-white px-5 pb-5 pt-4 lg:p-7">
            <div className="mb-4 flex items-center gap-4 rounded-2xl bg-white/80 px-4 py-4 shadow-sm ring-1 ring-[#f58220]/20">
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
                Optum Assistant
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
                className="rounded-full bg-white px-4 py-2 text-sm font-medium text-slate-900 shadow-sm ring-1 ring-[#f58220]/20 transition hover:-translate-y-0.5 hover:shadow-md disabled:opacity-60"
                onClick={() => handleSend(prompt)}
                disabled={loading}
              >
                {prompt}
              </button>
            ))}
          </div>

          {providerDiscoveryMode === "finding" && (
            <div className="mt-3 flex items-center gap-3 rounded-3xl border border-[#f58220]/25 bg-gradient-to-r from-[#f58220]/10 via-white to-white p-4 shadow-inner ring-1 ring-[#f58220]/20">
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[#f58220] text-lg text-white shadow-md">
                ✨
              </div>
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-[#f58220]">
                  AI mode
                </div>
                <div className="text-sm text-slate-700">
                  Searching the provider directory for {providerSpecialtyLabel.toLowerCase()} matches {providerLocationLabel}…
                </div>
              </div>
            </div>
          )}

          <div className="mt-4 flex min-h-0 flex-1 flex-col rounded-2xl border border-[#f58220]/25 bg-white/90 p-4 shadow-inner">
            <div
              className="flex-1 space-y-3 overflow-auto pr-1"
              ref={messagesContainerRef}
            >
              {messages.map((m, i) => {
                if (m.kind === "providers") {
                  if (!providerMatches || providerMatches.length === 0) return null;

                  return (
                    <div
                      key={`providers-${i}`}
                      className="space-y-3 rounded-3xl border border-[#f58220]/25 bg-white/95 p-4 shadow-lg shadow-[#f58220]/10 ring-1 ring-[#f58220]/15"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-[11px] font-semibold uppercase tracking-wide text-[#f58220]">
                            {providerSpecialtyLabel} {providerLocationLabel}
                          </div>
                          <div className="text-sm text-slate-600">AI-ranked providers based on what you asked for.</div>
                        </div>
                        <span className="rounded-full bg-[#f58220]/10 px-3 py-1 text-xs font-semibold text-[#f58220] ring-1 ring-[#f58220]/20">
                          Live
                        </span>
                      </div>

                      <div className="grid gap-3 md:grid-cols-2">
                        {providerMatches.slice(0, 4).map((p) => {
                          const slots = buildSlots(p);
                          return (
                            <div
                              key={p.provider_id}
                              className="group relative overflow-hidden rounded-2xl border border-[#f58220]/15 bg-gradient-to-br from-white via-white to-[#f58220]/5 p-3 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
                            >
                              <div className="flex items-center gap-3">
                                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-[#f58220] to-amber-400 text-sm font-semibold text-white shadow-inner">
                                  {providerInitials(p.name)}
                                </div>
                                <div className="flex-1">
                                  <div className="font-semibold text-slate-900">{p.name}</div>
                                  <div className="text-xs text-slate-600">
                                    {formatSpecialty(p.provider_type)} • {p.location_city}, {p.location_state}
                                  </div>
                                  <div className="text-[11px] uppercase tracking-wide text-[#f58220]">{p.location_name}</div>
                                </div>
                                <div className="text-right text-xs text-slate-600">
                                  {p.next_available_start ? (
                                    <div className="space-y-1 text-right">
                                      <div className="text-[11px] font-semibold uppercase text-[#f58220]">Next</div>
                                      <div className="text-sm font-semibold text-slate-900">
                                        {new Date(p.next_available_start).toLocaleString(undefined, {
                                          weekday: "short",
                                          hour: "numeric",
                                          minute: "2-digit",
                                        })}
                                      </div>
                                      <div className="text-[11px] text-slate-500">
                                        {p.next_available_mode === "virtual" ? "Virtual" : "In person"}
                                      </div>
                                    </div>
                                  ) : (
                                    <div className="text-[11px] text-slate-500">No openings in the next two weeks</div>
                                  )}
                                </div>
                              </div>

                              {p.accepts_virtual && (
                                <div className="mt-2 text-[11px] text-slate-500">Offers virtual visits</div>
                              )}

                              <div className="mt-3 space-y-2 rounded-xl bg-white/70 p-2 shadow-inner">
                                <div className="text-[11px] font-semibold uppercase tracking-wide text-[#f58220]">
                                  Available times
                                </div>
                                <div className="flex flex-wrap gap-2">
                                  {slots.map((slot) => {
                                    const isSelected =
                                      selectedAppointment?.provider.provider_id === p.provider_id &&
                                      selectedAppointment.slot.iso === slot.iso;

                                    return (
                                      <button
                                        key={slot.iso}
                                        onClick={() => handleSlotSelect(p, slot)}
                                        className={`rounded-full border px-3 py-1 text-xs font-semibold transition focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-white ${
                                          isSelected
                                            ? "border-[#f58220] bg-[#f58220] text-white shadow"
                                            : "border-[#f58220]/30 bg-white text-[#f58220] hover:border-[#f58220] hover:bg-[#f58220]/10"
                                        }`}
                                      >
                                        {slot.label}
                                        <span className="ml-1 text-[10px] font-normal text-slate-600">
                                          {slot.mode === "virtual" ? "Virtual" : "In person"}
                                        </span>
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                }

                if (m.kind === "appointment_overview") {
                  if (!selectedAppointment) return null;

                  return (
                    <div
                      key={`appointment-${i}`}
                      className="space-y-3 rounded-3xl border border-[#f58220]/20 bg-white/95 p-4 shadow-lg shadow-[#f58220]/10 ring-1 ring-[#f58220]/15"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-[11px] font-semibold uppercase tracking-wide text-[#f58220]">
                            Appointment overview
                          </div>
                          <div className="text-sm text-slate-600">
                            Confirm the time you picked and we’ll book the visit.
                          </div>
                        </div>
                        <span className="rounded-full bg-[#f58220]/10 px-3 py-1 text-xs font-semibold text-[#f58220] ring-1 ring-[#f58220]/25">
                          Pending
                        </span>
                      </div>

                      <div className="space-y-1 rounded-2xl bg-gradient-to-r from-white to-[#f58220]/10 p-3 ring-1 ring-[#f58220]/15">
                        <div className="text-sm font-semibold text-slate-900">{selectedAppointment.provider.name}</div>
                        <div className="text-xs text-slate-600">
                          {formatSpecialty(selectedAppointment.provider.provider_type)} • {selectedAppointment.provider.location_city}, {" "}
                          {selectedAppointment.provider.location_state}
                        </div>
                        <div className="text-xs text-slate-600">
                          Location: {selectedAppointment.provider.location_name}
                        </div>
                        <div className="text-sm font-semibold text-[#f58220]">
                          {selectedAppointment.slot.label} · {" "}
                          {selectedAppointment.slot.mode === "virtual" ? "Virtual visit" : "In-person visit"}
                        </div>
                      </div>

                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div className="text-xs text-slate-600">
                          We’ll send confirmation and check-in details after you confirm.
                        </div>
                        <button
                          onClick={confirmSelectedAppointment}
                          className="inline-flex items-center justify-center rounded-full bg-[#f58220] px-4 py-2 text-sm font-semibold text-white shadow transition hover:bg-[#d86d0f] focus:outline-none focus:ring-2 focus:ring-[#f58220] focus:ring-offset-2 focus:ring-offset-white"
                        >
                          Confirm appointment
                        </button>
                      </div>
                    </div>
                  );
                }

                if (m.kind === "insurance_filter") {
                  if (!insuranceFlowActive) return null;

                  return (
                    <div key={`insurance-${i}`} className="flex justify-start">
                      <div className="w-full space-y-3 rounded-2xl border border-[#f58220]/25 bg-white p-4 shadow-sm ring-1 ring-[#f58220]/15">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-xs font-semibold uppercase tracking-wide text-[#f58220]">
                              Insurance filter
                            </div>
                            <div className="text-sm text-slate-600">
                              Choose from a list of popular insurance plans.
                            </div>
                          </div>
                          {selectedInsurance && (
                            <span className="rounded-full bg-[#f58220]/10 px-3 py-1 text-xs font-semibold text-[#f58220] ring-1 ring-[#f58220]/20">
                              {selectedInsurance}
                            </span>
                          )}
                        </div>

                        <div className="flex flex-col gap-3 rounded-2xl bg-[#f58220]/10 p-3">
                          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-700">
                            Popular carriers
                          </div>

                          <div className="space-y-2">
                            {insurancePlans.map((plan) => {
                              const isSelected = plan.name === selectedInsurance;
                              return (
                                <button
                                  key={plan.name}
                                  className={`flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${
                                    isSelected
                                      ? "border-[#f58220]/50 bg-white"
                                      : "border-[#f58220]/20 bg-white"
                                  }`}
                                  onClick={() => handleInsuranceSelect(plan.name)}
                                >
                                  <div className="flex items-center gap-3">
                                    <div
                                      className="flex h-11 w-11 items-center justify-center rounded-xl text-sm font-semibold text-white shadow"
                                      style={{ backgroundColor: plan.color }}
                                    >
                                      {plan.shorthand}
                                    </div>
                                    <div>
                                      <div className="font-semibold text-slate-900">{plan.name}</div>
                                      <div className="text-xs text-slate-600">PCPs that accept your coverage</div>
                                    </div>
                                  </div>
                                  <div className="text-lg">{isSelected ? "✅" : ""}</div>
                                </button>
                              );
                            })}
                          </div>

                          <div className="text-xs text-slate-500">
                            Select your plan so I can tailor the care options.
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                }

                return (
                  <div
                    key={`message-${i}`}
                    className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
                  >
                    {m.kind === "success" ? (
                      <div className="flex max-w-[82%] items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 shadow-sm ring-1 ring-emerald-100">
                        <span className="mt-0.5 text-lg">✅</span>
                        <div className="space-y-1">
                          <div className="text-sm font-semibold text-emerald-900">Appointment set</div>
                          <div>{m.text}</div>
                        </div>
                      </div>
                    ) : (
                      <div
                        className={`max-w-[82%] rounded-2xl px-4 py-3 text-sm shadow transition ${
                          m.role === "user"
                            ? "rounded-br-sm bg-[#f58220] text-white"
                            : m.role === "system"
                            ? "bg-[#f58220]/10 text-[#f58220] ring-1 ring-[#f58220]/25"
                            : "bg-white text-slate-800 ring-1 ring-[#f58220]/20"
                        }`}
                      >
                        <div className="space-y-2">
                          <div>{m.text}</div>
                          {m.options && m.options.length > 0 && (
                            <div className="flex flex-wrap gap-2">
                              {m.options.map((option) => (
                                <button
                                  key={option}
                                  className="rounded-full border border-[#f58220]/25 bg-[#f58220]/5 px-3 py-1 text-xs font-semibold text-[#f58220] transition hover:-translate-y-0.5 hover:border-[#f58220]/50 hover:bg-[#f58220]/10 disabled:opacity-60"
                                  onClick={() => handleSend(option)}
                                  disabled={loading}
                                >
                                  {option}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
              {loading && <div className="text-sm text-slate-500">Thinking…</div>}
              <div ref={scrollAnchorRef} />
            </div>
          </div>

          
        </div>

        {symptomFlowActive && (
          <div className="flex flex-col gap-4 bg-white/95 px-5 py-5 lg:overflow-y-auto lg:px-6 lg:py-7">
            <div className="space-y-3 rounded-2xl border border-[#f58220]/25 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-[#f58220]">
                    Symptom checker
                  </div>
                  <div className="text-sm text-slate-600">
                    I’ll ask a few questions, then find urgent care near you.
                  </div>
                </div>
                <span className="rounded-full bg-[#f58220]/10 px-3 py-1 text-[11px] font-semibold text-[#f58220] ring-1 ring-[#f58220]/20">
                  {geoStatusLabel}
                </span>
              </div>

              {!symptomComplete && (
                <div className="space-y-3 rounded-xl bg-[#f58220]/10 p-3">
                  <div className="text-sm font-semibold text-slate-900">
                    {symptomQuestions[symptomStep]?.question}
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {symptomQuestions[symptomStep]?.options.map((option) => (
                      <button
                        key={option}
                        className="rounded-xl bg-white px-3 py-2 text-sm font-medium text-slate-800 ring-1 ring-[#f58220]/25 transition hover:-translate-y-0.5 hover:shadow"
                        onClick={() => answerSymptomQuestion(option)}
                        disabled={loading}
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                  <div className="text-xs text-slate-500">
                    Question {symptomStep + 1} of {symptomQuestions.length}
                  </div>
                </div>
              )}

              {symptomComplete && (
                <div className="space-y-3 rounded-xl bg-[#f58220]/10 p-3">
                  <div className="text-sm font-semibold text-slate-900">
                    Great, here’s what I gathered:
                  </div>
                  <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
                    {symptomQuestions.map((q) => (
                      <li key={q.id}>
                        {q.question}: <span className="font-semibold">{symptomResponses[q.id]}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="text-sm text-[#f58220]">
                    I’ll remember these details as I look for urgent care options {userLocation ? `near ${userLocation}` : "near you"}.
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        </div>

        {searchSuggestions &&
          lastSuggestionQuery &&
          (searchSuggestions.providers.length > 0 ||
            searchSuggestions.suggestions.length > 0) && (
            <div className="mx-5 mb-2 rounded-2xl border border-[#f58220]/20 bg-white/95 p-4 shadow-sm ring-1 ring-[#f58220]/15 lg:mx-6">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-[#f58220]">
                    Suggested search
                  </div>
                  <div className="text-sm text-slate-700">
                    {searchSuggestions.providers.length > 0
                      ? `Quick matches for "${lastSuggestionQuery}".`
                      : `Did you mean one of these names related to "${lastSuggestionQuery}"?`}
                  </div>
                </div>
                <span className="text-lg">🔍</span>
              </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  {(searchSuggestions.providers.length > 0
                    ? searchSuggestions.providers
                    : searchSuggestions.suggestions
                  )
                    .filter((p) => p.name?.trim())
                    .map((p) => {
                      const typeLabel = p.provider_type?.replace("_", " ");

                      return (
                        <button
                          key={p.provider_id}
                          className="flex items-center gap-2 rounded-full border border-[#f58220]/20 bg-white/80 px-3 py-2 text-sm font-semibold text-slate-800 shadow-sm ring-1 ring-[#f58220]/20 transition hover:-translate-y-0.5 hover:border-[#f58220]/40 hover:shadow-md"
                          onClick={() => {
                            setInput(p.name);
                            setSearchSuggestions(null);
                            setLastSuggestionQuery("");
                            handleSend(p.name);
                          }}
                          disabled={loading}
                        >
                          {typeLabel ? (
                            <span className="rounded-full bg-[#f58220]/10 px-2 py-1 text-xs font-medium text-slate-800">
                              {typeLabel}
                            </span>
                          ) : null}
                          <span className="text-sm font-semibold text-slate-800">{p.name}</span>
                        </button>
                      );
                    })}
                </div>
            </div>
          )}

        <div className="sticky bottom-0 flex items-center gap-3 border-t border-[#f58220]/20 bg-white/95 px-5 py-4 lg:px-6">
          <input
            className="flex-1 rounded-full border border-[#f58220]/30 bg-[#f58220]/5 px-4 py-3 text-sm placeholder:text-slate-400 shadow-sm focus:outline-none"
            placeholder="Ask Optum Assistant"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSend()}
          />
          <button
            className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-lg text-[#f58220] shadow-sm ring-1 ring-[#f58220]/20 transition hover:-translate-y-0.5 hover:shadow-md disabled:opacity-50"
            onClick={handleVoiceChat}
            disabled={loading}
            aria-label="Start voice chat"
            type="button"
          >
            🎤
          </button>
          <button
            className="flex h-12 w-12 items-center justify-center rounded-full bg-[#f58220] text-white shadow-md transition hover:shadow-lg disabled:opacity-50"
            onClick={() => handleSend()}
            disabled={loading}
            aria-label="Send message"
          >
            ↑
          </button>
        </div>
      </section>
    </main>
  );
}
