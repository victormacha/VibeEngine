// Ajuda a testar a engine 100% local, sem Netlify nem Supabase.
// Só funciona em localhost/127.0.0.1 — em produção isso fica inerte.
const DEV_KEY_STORAGE = "vibegame_dev_gemini_key";

export function isLocalHost() {
  return ["localhost", "127.0.0.1"].includes(location.hostname);
}

export function getDevKey() {
  return sessionStorage.getItem(DEV_KEY_STORAGE) || "";
}

export function setDevKey(key) {
  if (key) sessionStorage.setItem(DEV_KEY_STORAGE, key);
  else sessionStorage.removeItem(DEV_KEY_STORAGE);
}

export function askForDevKey() {
  const current = getDevKey();
  const key = window.prompt(
    "Modo de teste local: cole sua chave da API Gemini (aistudio.google.com/apikey).\n" +
      "Fica só nesta aba do navegador (sessionStorage) — nunca vá pra produção assim.",
    current
  );
  if (key) setDevKey(key.trim());
  return getDevKey();
}
