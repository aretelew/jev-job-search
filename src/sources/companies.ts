/**
 * Company boards worth polling directly. Seeded from every Greenhouse, Lever, Ashby and Gem URL the
 * list sources mention (those companies are hiring early-career now), plus a hand-kept list of
 * boards that post Canadian and remote early-career software roles. Polling the board catches
 * postings the lists have not picked up yet, which is where the freshest ones are.
 */
import { ashbySlug, fetchAshbyBoard } from "./ats/ashby.js";
import { fetchGemBoard, gemSlug } from "./ats/gem.js";
import { fetchGreenhouseBoard, greenhouseSlug } from "./ats/greenhouse.js";
import { fetchLeverBoard, leverSlug } from "./ats/lever.js";
import type { Job } from "../jobs/normalize.js";

/** Each board the tool can read whole: how a posting link names its board, and how the board is read. */
const READERS = {
  greenhouse: { slug: greenhouseSlug, read: fetchGreenhouseBoard },
  lever: { slug: leverSlug, read: fetchLeverBoard },
  ashby: { slug: ashbySlug, read: fetchAshbyBoard },
  gem: { slug: gemSlug, read: fetchGemBoard },
} satisfies Record<string, { slug: (url: string) => string | null; read: (slug: string, company: string) => Promise<Job[]> }>;

export type Board = { ats: keyof typeof READERS; slug: string; company: string };

const readable = (ats: string): ats is Board["ats"] => Object.hasOwn(READERS, ats);
const boardKey = (b: Board) => `${b.ats}:${b.slug.toLowerCase()}`;

/** Every posting on one board, read from its API. */
export const readBoard = (b: Board): Promise<Job[]> => READERS[b.ats].read(b.slug, b.company);

/** Boards polled on every discover run regardless of what the lists mention. */
export const SEED_BOARDS: Board[] = [
  { ats: "greenhouse", slug: "stripe", company: "Stripe" },
  { ats: "greenhouse", slug: "doordashcanada", company: "DoorDash" },
  { ats: "greenhouse", slug: "doordashusa", company: "DoorDash" },
  { ats: "greenhouse", slug: "databricks", company: "Databricks" },
  { ats: "greenhouse", slug: "figma", company: "Figma" },
  { ats: "greenhouse", slug: "notion", company: "Notion" },
  { ats: "greenhouse", slug: "cloudflare", company: "Cloudflare" },
  { ats: "greenhouse", slug: "coinbase", company: "Coinbase" },
  { ats: "greenhouse", slug: "lyft", company: "Lyft" },
  { ats: "greenhouse", slug: "roblox", company: "Roblox" },
  { ats: "greenhouse", slug: "samsara", company: "Samsara" },
  { ats: "greenhouse", slug: "anthropic", company: "Anthropic" },
  { ats: "greenhouse", slug: "hudsonrivertrading", company: "Hudson River Trading" },
  { ats: "greenhouse", slug: "affirm", company: "Affirm" },
  { ats: "greenhouse", slug: "faire", company: "Faire" },
  { ats: "greenhouse", slug: "duolingo", company: "Duolingo" },
  { ats: "greenhouse", slug: "shopify", company: "Shopify" },
  { ats: "greenhouse", slug: "hopper", company: "Hopper" },
  { ats: "greenhouse", slug: "clio", company: "Clio" },
  { ats: "greenhouse", slug: "benchsci", company: "BenchSci" },
  { ats: "greenhouse", slug: "ada", company: "Ada" },
  { ats: "greenhouse", slug: "pinterest", company: "Pinterest" },
  { ats: "greenhouse", slug: "reddit", company: "Reddit" },
  { ats: "greenhouse", slug: "dropbox", company: "Dropbox" },
  { ats: "greenhouse", slug: "asana", company: "Asana" },
  { ats: "greenhouse", slug: "twilio", company: "Twilio" },
  { ats: "greenhouse", slug: "datadog", company: "Datadog" },
  { ats: "greenhouse", slug: "mongodb", company: "MongoDB" },
  { ats: "greenhouse", slug: "elastic", company: "Elastic" },
  { ats: "greenhouse", slug: "gitlab", company: "GitLab" },
  { ats: "greenhouse", slug: "hashicorp", company: "HashiCorp" },
  { ats: "greenhouse", slug: "1password", company: "1Password" },
  { ats: "greenhouse", slug: "wealthsimple", company: "Wealthsimple" },
  { ats: "greenhouse", slug: "neo", company: "Neo Financial" },
  { ats: "greenhouse", slug: "instacart", company: "Instacart" },
  { ats: "greenhouse", slug: "airbnb", company: "Airbnb" },
  { ats: "lever", slug: "plaid", company: "Plaid" },
  { ats: "lever", slug: "mistral", company: "Mistral AI" },
  { ats: "lever", slug: "palantir", company: "Palantir" },
  { ats: "lever", slug: "kraken", company: "Kraken" },
  { ats: "lever", slug: "zoox", company: "Zoox" },
  { ats: "lever", slug: "ledn", company: "Ledn" },
  { ats: "ashby", slug: "cohere", company: "Cohere" },
  { ats: "ashby", slug: "wealthsimple", company: "Wealthsimple" },
  { ats: "ashby", slug: "1password", company: "1Password" },
  { ats: "ashby", slug: "zip", company: "Zip" },
  { ats: "ashby", slug: "elevenlabs", company: "ElevenLabs" },
  { ats: "ashby", slug: "replit", company: "Replit" },
  { ats: "ashby", slug: "ramp", company: "Ramp" },
  { ats: "ashby", slug: "linear", company: "Linear" },
  { ats: "ashby", slug: "vercel", company: "Vercel" },
  { ats: "ashby", slug: "supabase", company: "Supabase" },
  { ats: "ashby", slug: "openai", company: "OpenAI" },
  { ats: "ashby", slug: "perplexity", company: "Perplexity" },
  { ats: "ashby", slug: "cursor", company: "Cursor" },
  { ats: "ashby", slug: "deel", company: "Deel" },
  { ats: "ashby", slug: "mercury", company: "Mercury" },
  { ats: "ashby", slug: "float", company: "Float" },
  { ats: "ashby", slug: "shakudo", company: "Shakudo" },
  { ats: "ashby", slug: "superhuman", company: "Superhuman" },
  { ats: "ashby", slug: "Superhuman%20Platform%20Inc", company: "Superhuman" },
  // Companies with offices in Vancouver, or elsewhere in Western Canada, whose postings the lists often miss.
  { ats: "greenhouse", slug: "hootsuite", company: "Hootsuite" },
  { ats: "greenhouse", slug: "later", company: "Later" },
  { ats: "greenhouse", slug: "abcellera", company: "AbCellera" },
  { ats: "greenhouse", slug: "aspectbiosystems", company: "Aspect Biosystems" },
  { ats: "greenhouse", slug: "layerzerolabs", company: "LayerZero Labs" },
  { ats: "greenhouse", slug: "brex", company: "Brex" },
  { ats: "greenhouse", slug: "7shifts", company: "7shifts" },
  { ats: "lever", slug: "kabam", company: "Kabam" },
  { ats: "lever", slug: "apryse", company: "Apryse" },
  { ats: "lever", slug: "blackbirdinteractive", company: "Blackbird Interactive" },
  { ats: "ashby", slug: "klue", company: "Klue" },
  { ats: "ashby", slug: "trulioo", company: "Trulioo" },
  { ats: "ashby", slug: "spare", company: "Spare" },
  { ats: "ashby", slug: "neofinancial", company: "Neo Financial" },
  { ats: "ashby", slug: "jobber", company: "Jobber" },
  { ats: "ashby", slug: "lightspeedhq", company: "Lightspeed" },
  { ats: "gem", slug: "nominal", company: "Nominal" },
];

/** Every board the given jobs point at, merged with the seed list, deduped by ats+slug. */
export function boardsFromJobs(jobs: Job[], seeds: Board[] = SEED_BOARDS): Board[] {
  const map = new Map<string, Board>();
  const add = (b: Board) => {
    if (!map.has(boardKey(b))) map.set(boardKey(b), b);
  };
  seeds.forEach(add);
  for (const j of jobs) {
    if (!readable(j.ats)) continue;
    const slug = READERS[j.ats].slug(j.url);
    if (slug) add({ ats: j.ats, slug, company: j.company });
  }
  return [...map.values()];
}
