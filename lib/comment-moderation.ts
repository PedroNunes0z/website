const TEXT_URL = "https://api.sightengine.com/1.0/text/check.json";
const IMAGE_URL = "https://api.sightengine.com/1.0/check.json";
const RULES = ["profanity", "violence", "self-harm"];

type Result = {
  status?: string;
  moderation_classes?: Record<string, number>;
  [key: string]: unknown;
};

function credentials() {
  const user = process.env.SIGHT_ENGINE_API_USER;
  const key = process.env.SIGHT_ENGINE_API_KEY;
  if (!user || !key) throw new Error("Moderação indisponível no momento.");
  return { user, key };
}

async function check(url: string, form: FormData, timeout: number): Promise<Result> {
  let response: Response;
  try {
    response = await fetch(url, { method: "POST", body: form, signal: AbortSignal.timeout(timeout), cache: "no-store" });
  } catch {
    throw new Error("Moderação indisponível no momento. Tente novamente.");
  }
  if (!response.ok) throw new Error("Moderação indisponível no momento. Tente novamente.");
  const result = await response.json().catch(() => null) as Result | null;
  if (!result || result.status !== "success") throw new Error("Moderação indisponível no momento. Tente novamente.");
  return result;
}

function formWithCredentials() {
  const { user, key } = credentials();
  const form = new FormData();
  form.append("api_user", user);
  form.append("api_secret", key);
  return form;
}

export function isUnsafeText(result: Result) {
  const classes = result.moderation_classes ?? {};
  if (["sexual", "discriminatory", "insulting", "violent", "toxic"].some((name) => Number(classes[name] ?? 0) >= 0.7)) return true;
  return RULES.some((name) => {
    const item = result[name];
    return !!item && typeof item === "object" && "matches" in item && Array.isArray(item.matches) && item.matches.length > 0;
  });
}

export async function moderateCommentText(text: string) {
  const form = formWithCredentials();
  form.append("text", text);
  form.append("lang", "pt");
  form.append("models", "general");
  form.append("categories", RULES.join(","));
  form.append("mode", "rules,ml");
  if (isUnsafeText(await check(TEXT_URL, form, 10_000))) {
    throw new Error("O texto não atende às regras de segurança da comunidade.");
  }
}

export async function validateCommentImage(file: File) {
  const allowed = new Set(["image/jpeg", "image/png", "image/webp"]);
  if (!allowed.has(file.type) || file.size > 2 * 1024 * 1024 || file.size === 0) {
    throw new Error("Use uma imagem JPG, PNG ou WebP de até 2 MB.");
  }
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const jpeg = file.type === "image/jpeg" && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png = file.type === "image/png" && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  const webp = file.type === "image/webp" && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  if (!jpeg && !png && !webp) throw new Error("O arquivo não corresponde ao formato informado.");
}

const unsafeImageScores: Array<[RegExp, number]> = [
  [/(^|\.)(sexual_activity|sexual_display|erotica|visibly_undressed)(\.|$)/i, 0.55],
  [/(^|\.)(very_suggestive|suggestive|suggestive_focus|suggestive_pose)(\.|$)/i, 0.78],
  [/(^|\.)(recreational_drug|medical(?:_drug)?|offensive|gore|violence|self[_-]harm|gambling)(\.|$)/i, 0.65],
  [/(^|\.)(nazi|terrorist|confederate|supremacist|asian_swastika)(\.|$)/i, 0.5],
  [/(^|\.)(very_bloody|slightly_bloody|body_organ|serious_injury|physical_violence|firearm_threat)(\.|$)/i, 0.6],
];

function scores(value: unknown, path = ""): Array<{ path: string; score: number }> {
  if (typeof value === "number") return [{ path, score: value }];
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.entries(value).flatMap(([key, child]) => scores(child, path ? `${path}.${key}` : key));
}

export function isUnsafeImage(result: Result) {
  return scores(result).some(({ path, score }) => unsafeImageScores.some(([pattern, threshold]) => pattern.test(path) && score >= threshold));
}

export async function moderateCommentImage(file: File) {
  await validateCommentImage(file);
  const form = formWithCredentials();
  form.append("media", file, file.name || "comentario");
  form.append("models", "nudity-2.1,recreational_drug,medical,offensive-2.0,face-age,gore-2.0,qr-content,violence,self-harm,gambling");
  if (isUnsafeImage(await check(IMAGE_URL, form, 12_000))) {
    throw new Error("A imagem não atende às regras de segurança da comunidade.");
  }
}
