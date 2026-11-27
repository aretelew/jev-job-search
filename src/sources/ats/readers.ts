/**
 * The boards the tool reads through their public APIs, in one table. Discover polls them
 * (src/sources/companies.ts), describe reads their postings, and apply takes their links.
 */
import { ashbyJobId, ashbySlug, fetchAshbyBoard, fetchAshbyJob } from "./ashby.js";
import { bambooSlug, fetchBambooBoard, fetchBambooJob } from "./bamboohr.js";
import { fetchGemBoard, fetchGemJob, gemJobId, gemSlug } from "./gem.js";
import { fetchGreenhouseBoard, fetchGreenhouseJob, greenhouseJobId, greenhouseSlug } from "./greenhouse.js";
import { fetchLeverBoard, fetchLeverJob, leverJobId, leverSlug } from "./lever.js";
import { fetchSmartRecruitersBoard, fetchSmartRecruitersJob, fetchSmartRecruitersPosting, smartRecruitersJobId, smartRecruitersSlug } from "./smartrecruiters.js";
import { fetchWorkableBoard, fetchWorkableJob, workableJobId, workableSlug } from "./workable.js";
import { bambooOpening, type Job } from "../../jobs/normalize.js";

/** A board the tool reads through its public API. */
export type Reader = {
  /** The board a posting link belongs to, or null for a link that is not this board's. */
  slug: (url: string) => string | null;
  /** The posting a link names on its board. */
  jobId: (url: string) => string | null;
  /** Every posting on one board. */
  read: (slug: string, company: string) => Promise<Job[]>;
  /** One posting's description. */
  describe: (slug: string, id: string, company: string) => Promise<string | null>;
  /** One posting by its link, for a board too large to read whole to find it. */
  posting?: (slug: string, id: string) => Promise<Job | null>;
};

/** Each board the tool can read whole. */
const READERS = {
  greenhouse: { slug: greenhouseSlug, jobId: greenhouseJobId, read: fetchGreenhouseBoard, describe: fetchGreenhouseJob },
  lever: { slug: leverSlug, jobId: leverJobId, read: fetchLeverBoard, describe: fetchLeverJob },
  ashby: { slug: ashbySlug, jobId: ashbyJobId, read: fetchAshbyBoard, describe: fetchAshbyJob },
  gem: { slug: gemSlug, jobId: gemJobId, read: fetchGemBoard, describe: fetchGemJob },
  smartrecruiters: { slug: smartRecruitersSlug, jobId: smartRecruitersJobId, read: fetchSmartRecruitersBoard, describe: fetchSmartRecruitersJob, posting: fetchSmartRecruitersPosting },
  workable: { slug: workableSlug, jobId: workableJobId, read: fetchWorkableBoard, describe: fetchWorkableJob },
  bamboohr: { slug: bambooSlug, jobId: bambooOpening, read: fetchBambooBoard, describe: fetchBambooJob },
} satisfies Record<string, Reader>;

/** The name of a board the tool reads: greenhouse, lever, and the rest of the table. */
export type ReadableAts = keyof typeof READERS;

export const readable = (ats: string): ats is ReadableAts => Object.hasOwn(READERS, ats);

/** The reader for a job's board, or null for a board the tool does not read through an API. */
export function readerFor(ats: ReadableAts): Reader;
export function readerFor(ats: string): Reader | null;
export function readerFor(ats: string): Reader | null {
  return readable(ats) ? READERS[ats] : null;
}

/** Every reader, in the order a link is tried against them. */
export const readers: readonly Reader[] = Object.values(READERS);
