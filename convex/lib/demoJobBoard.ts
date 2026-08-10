// ============================================================================
// ShortVoice -- SIMULATED job board  (Person B)
// ============================================================================
// THIS IS DEMO DATA. There is no applicant tracking system behind this file:
// no HTTP request, no API key, no board token, nothing to configure. Every
// listing below is hardcoded here, and `job_apply` submits by marking its own
// Convex rows submitted. If you are looking for the live integration, there
// isn't one -- adding it means replacing `findDemoJobListings` and the
// simulated submit in convex/jobApply.ts with real calls.
//
// What is NOT faked is the matching. The same token/alias ranking runs over
// these fixtures, so "Apply AI Engineer SF" earns its three results, a
// different role returns different jobs, and a fragment that matches nothing
// returns nothing. The demo shows real resolution over simulated listings.
//
// The form model is deliberately ATS-shaped (labelled questions, typed fields,
// select options), because that is what the review queue and the `answers` /
// `formQuestions` columns in the schema are built to render.
// ============================================================================

/** What the batch records as the source of these listings. */
export const DEMO_BOARD_NAME = "ShortVoice Demo Job Board";

export type DemoFormFieldOption = { label: string; value: string };

export type DemoFormField = {
  name: string;
  /** ATS-shaped field type: input_text, textarea, input_file, multi_value_*_select. */
  type: string;
  values?: DemoFormFieldOption[];
};

export type DemoFormQuestion = {
  label: string;
  required: boolean;
  fields: DemoFormField[];
};

export type DemoJobSummary = {
  id: number;
  title: string;
  absolute_url: string;
  location?: { name?: string };
  company_name?: string;
};

export type DemoJobListing = DemoJobSummary & {
  questions: DemoFormQuestion[];
};

export type ApplicantProfileInput = {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  location?: string;
  latitude?: string;
  longitude?: string;
  countryShortName?: string;
  linkedInUrl?: string;
  portfolioUrl?: string;
  workAuthorization?: string;
  requiresSponsorship?: string;
  defaultAnswers: Array<{ key: string; value: string | string[] }>;
  resumeStorageId?: unknown;
};

export type SerializedFormQuestion = {
  label: string;
  required: boolean;
  fields: Array<{
    name: string;
    type: string;
    values?: DemoFormFieldOption[];
  }>;
};

export type MappedApplicationForm = {
  status: "ready" | "review_required";
  resumeAttached: boolean;
  answers: Array<{ field: string; value: string | string[] }>;
  formQuestions: SerializedFormQuestion[];
  missingQuestions: Array<{ label: string; fieldNames: string[] }>;
};

const WORD_ALIASES: Record<string, string> = {
  ai: "artificial intelligence",
  ml: "machine learning",
  sf: "san francisco",
  nyc: "new york city",
};

const STANDARD_REQUIRED_FIELDS = [
  { label: "First Name", name: "first_name", type: "input_text" },
  { label: "Last Name", name: "last_name", type: "input_text" },
  { label: "Email", name: "email", type: "input_text" },
] as const;

const YES_NO = [
  { label: "No", value: "0" },
  { label: "Yes", value: "1" },
];

/**
 * The questions most listings ask. Everything here is answerable from a saved
 * applicant profile, which is what makes a row `ready` without human help.
 * The resume question carries a textarea alongside the file field, so a person
 * who has not uploaded a PDF can still complete the row from the review queue.
 */
function commonQuestions(): DemoFormQuestion[] {
  return [
    { label: "First Name", required: true, fields: [{ name: "first_name", type: "input_text" }] },
    { label: "Last Name", required: true, fields: [{ name: "last_name", type: "input_text" }] },
    { label: "Email", required: true, fields: [{ name: "email", type: "input_text" }] },
    { label: "Phone", required: false, fields: [{ name: "phone", type: "input_text" }] },
    {
      label: "Resume",
      required: true,
      fields: [
        { name: "resume", type: "input_file" },
        { name: "resume_text", type: "textarea" },
      ],
    },
    {
      label: "LinkedIn Profile",
      required: false,
      fields: [{ name: "urls[LinkedIn]", type: "input_text" }],
    },
    {
      label: "Are you authorized to work in the United States?",
      required: true,
      fields: [
        { name: "question_work_authorization", type: "multi_value_single_select", values: YES_NO },
      ],
    },
  ];
}

/**
 * The simulated board. Titles, companies, locations and questions are invented
 * for the demo; the companies do not exist. Ordering matters only as a
 * tie-break inside the ranking, and the ids stand in for a board's job ids.
 */
export const DEMO_JOB_LISTINGS: DemoJobListing[] = [
  {
    id: 4181,
    title: "AI Engineer",
    company_name: "Lumen Labs",
    location: { name: "San Francisco, CA" },
    absolute_url: "https://demo.shortvoice.test/lumen-labs/ai-engineer",
    questions: commonQuestions(),
  },
  {
    // The review-required row in the demo: no profile can answer this one, so
    // it stages as `review_required` and waits for saveReviewAnswers.
    id: 4182,
    title: "Senior AI Engineer, Applied",
    company_name: "Halcyon AI",
    location: { name: "San Francisco, CA" },
    absolute_url: "https://demo.shortvoice.test/halcyon-ai/senior-ai-engineer-applied",
    questions: [
      ...commonQuestions(),
      {
        label: "Why do you want to work on applied AI at Halcyon?",
        required: true,
        fields: [{ name: "question_why_halcyon", type: "textarea" }],
      },
    ],
  },
  {
    id: 4183,
    title: "AI Engineer, Inference",
    company_name: "Foundry Systems",
    location: { name: "Palo Alto, CA" },
    absolute_url: "https://demo.shortvoice.test/foundry-systems/ai-engineer-inference",
    questions: [
      ...commonQuestions(),
      {
        label: "Which inference stacks have you shipped to production?",
        required: false,
        fields: [
          {
            name: "question_inference_stacks",
            type: "multi_value_multi_select",
            values: [
              { label: "vLLM", value: "vllm" },
              { label: "TensorRT-LLM", value: "tensorrt" },
              { label: "Triton", value: "triton" },
              { label: "llama.cpp", value: "llamacpp" },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 4184,
    title: "Machine Learning Engineer, Ranking",
    company_name: "Northwind Robotics",
    location: { name: "San Francisco, CA" },
    absolute_url: "https://demo.shortvoice.test/northwind-robotics/ml-engineer-ranking",
    questions: commonQuestions(),
  },
  {
    id: 4185,
    title: "AI Research Engineer",
    company_name: "Cobalt Health",
    location: { name: "New York, NY" },
    absolute_url: "https://demo.shortvoice.test/cobalt-health/ai-research-engineer",
    questions: commonQuestions(),
  },
  {
    id: 4186,
    title: "Forward Deployed AI Engineer",
    company_name: "Meridian Systems",
    location: { name: "Remote - United States" },
    absolute_url: "https://demo.shortvoice.test/meridian-systems/forward-deployed-ai-engineer",
    questions: commonQuestions(),
  },
  {
    id: 4187,
    title: "Backend Engineer, Platform",
    company_name: "Lumen Labs",
    location: { name: "Austin, TX" },
    absolute_url: "https://demo.shortvoice.test/lumen-labs/backend-engineer-platform",
    questions: commonQuestions(),
  },
  {
    id: 4188,
    title: "Product Designer",
    company_name: "Halcyon AI",
    location: { name: "San Francisco, CA" },
    absolute_url: "https://demo.shortvoice.test/halcyon-ai/product-designer",
    questions: commonQuestions(),
  },
];

/** The whole of job discovery: rank the fixtures, take the best few. */
export function findDemoJobListings(role: string, location: string, limit = 3) {
  return rankDemoJobListings(DEMO_JOB_LISTINGS, role, location, limit);
}

export function rankDemoJobListings<T extends DemoJobSummary>(
  jobs: T[],
  role: string,
  location: string,
  limit = 3,
): T[] {
  const roleTokens = tokenSet(role);
  const locationTokens = tokenSet(location);
  return jobs
    .map((job, position) => {
      const roleScore = overlapScore(roleTokens, tokenSet(job.title));
      const locationName = job.location?.name ?? "";
      const locationScore =
        locationTokens.size === 0 ? 1 : overlapScore(locationTokens, tokenSet(locationName));
      const exactRoleBonus =
        normalizeText(job.title).includes(normalizeText(role)) && role.trim().length > 0 ? 0.2 : 0;
      return {
        job,
        position,
        roleScore,
        score: 0.78 * Math.min(1, roleScore + exactRoleBonus) + 0.22 * locationScore,
      };
    })
    .filter((candidate) => candidate.roleScore > 0)
    .sort((a, b) => b.score - a.score || a.position - b.position)
    .slice(0, Math.max(0, limit))
    .map(({ job }) => job);
}

/**
 * Fill one listing's form from the saved profile. A row is `ready` only when
 * every required question is answered; anything left over becomes a
 * `missingQuestions` entry for the review queue.
 */
export function mapDemoApplicationForm(
  job: DemoJobListing,
  profile: ApplicantProfileInput | null,
): MappedApplicationForm {
  const resumeAttached = Boolean(profile?.resumeStorageId);
  const formQuestions = ensureStandardQuestions(job.questions ?? []).map(serializeQuestion);

  const defaults = new Map<string, string | string[]>();
  for (const answer of profile?.defaultAnswers ?? []) {
    defaults.set(answer.key.trim().toLowerCase(), answer.value);
    defaults.set(normalizeText(answer.key), answer.value);
  }

  const answers = new Map<string, string | string[]>();
  for (const question of formQuestions) {
    for (const field of question.fields) {
      const raw = answerForField(field, question.label, profile, defaults);
      const answer = coerceAnswer(field, raw);
      if (answer !== undefined && answerIsPresent(answer)) answers.set(field.name, answer);
    }
  }

  const serializedAnswers = [...answers].map(([field, value]) => ({ field, value }));
  const missingQuestions = formQuestions
    .filter((question) => question.required && !questionIsAnswered(question, answers, resumeAttached))
    .map((question) => ({
      label: question.label,
      fieldNames: question.fields.map((field) => field.name),
    }));

  return {
    status: missingQuestions.length === 0 ? "ready" : "review_required",
    resumeAttached,
    answers: serializedAnswers,
    formQuestions,
    missingQuestions,
  };
}

/**
 * The same completeness rule, re-checked at submit time. A resume cleared or a
 * form edited after preparation has to fail that one row honestly rather than
 * be reported as submitted.
 */
export function unansweredRequiredQuestions(
  formQuestions: SerializedFormQuestion[],
  answers: Array<{ field: string; value: string | string[] }>,
  resumeAttached: boolean,
): string[] {
  const byField = new Map(answers.map((answer) => [answer.field, answer.value]));
  return formQuestions
    .filter((question) => question.required && !questionIsAnswered(question, byField, resumeAttached))
    .map((question) => question.label);
}

function questionIsAnswered(
  question: SerializedFormQuestion,
  answers: Map<string, string | string[]>,
  resumeAttached: boolean,
) {
  return question.fields.some(
    (field) =>
      (field.type === "input_file" && field.name === "resume" && resumeAttached) ||
      (field.type !== "input_file" && answerIsPresent(answers.get(field.name))),
  );
}

function ensureStandardQuestions(questions: DemoFormQuestion[]) {
  const result = [...questions];
  const presentFields = new Set(
    questions.flatMap((question) => question.fields.map((field) => field.name)),
  );
  for (const field of STANDARD_REQUIRED_FIELDS) {
    if (!presentFields.has(field.name)) {
      result.unshift({
        label: field.label,
        required: true,
        fields: [{ name: field.name, type: field.type }],
      });
    }
  }
  return result;
}

function serializeQuestion(question: DemoFormQuestion): SerializedFormQuestion {
  return {
    label: String(question.label ?? "Application question"),
    required: Boolean(question.required),
    fields: (question.fields ?? []).map((field) => ({
      name: String(field.name ?? ""),
      type: String(field.type ?? "input_text"),
      values: field.values?.map((value) => ({
        label: String(value.label ?? value.value ?? ""),
        value: String(value.value ?? ""),
      })),
    })),
  };
}

function answerForField(
  field: SerializedFormQuestion["fields"][number],
  label: string,
  profile: ApplicantProfileInput | null,
  defaults: Map<string, string | string[]>,
) {
  const standard: Record<string, string | undefined> = {
    first_name: profile?.firstName,
    last_name: profile?.lastName,
    email: profile?.email,
    phone: profile?.phone,
    location: profile?.location,
    latitude: profile?.latitude,
    longitude: profile?.longitude,
    country_short_name: profile?.countryShortName,
  };
  if (standard[field.name]) return standard[field.name];

  const exactDefault =
    defaults.get(field.name.toLowerCase()) ??
    defaults.get(normalizeText(field.name)) ??
    defaults.get(normalizeText(label));
  if (exactDefault !== undefined) return exactDefault;

  const normalizedLabel = normalizeText(label);
  if (normalizedLabel.includes("linkedin")) return profile?.linkedInUrl;
  if (normalizedLabel.includes("portfolio") || normalizedLabel.includes("personal website")) {
    return profile?.portfolioUrl;
  }
  if (normalizedLabel.includes("authorized") || normalizedLabel.includes("work authorization")) {
    return profile?.workAuthorization;
  }
  if (normalizedLabel.includes("sponsor")) return profile?.requiresSponsorship;
  return undefined;
}

function coerceAnswer(
  field: SerializedFormQuestion["fields"][number],
  answer: string | string[] | undefined,
) {
  if (answer === undefined) return undefined;
  const isMulti = field.type === "multi_value_multi_select";
  const source = Array.isArray(answer) ? answer : [answer];
  const values = source
    .map((item) => resolveOptionValue(field.values, item))
    .filter((item): item is string => item !== undefined && item.trim().length > 0);
  return isMulti ? values : values[0];
}

function resolveOptionValue(options: DemoFormFieldOption[] | undefined, answer: string) {
  const trimmed = answer.trim();
  if (!options?.length) return trimmed;
  const normalized = normalizeText(trimmed);
  const option = options.find(
    (candidate) => normalizeText(candidate.label) === normalized || candidate.value === trimmed,
  );
  return option?.value;
}

function answerIsPresent(value: string | string[] | undefined) {
  return Array.isArray(value)
    ? value.some((item) => item.trim().length > 0)
    : typeof value === "string" && value.trim().length > 0;
}

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokenSet(value: string) {
  const expanded = normalizeText(value)
    .split(/\s+/)
    .filter(Boolean)
    .flatMap((word) => [word, ...(WORD_ALIASES[word]?.split(" ") ?? [])]);
  return new Set(expanded);
}

function overlapScore(query: Set<string>, candidate: Set<string>) {
  if (query.size === 0 || candidate.size === 0) return 0;
  let overlap = 0;
  for (const word of query) {
    if (candidate.has(word)) overlap++;
  }
  return overlap / query.size;
}
