const BASE_URL = "https://openlibrary.org";
const SEARCH_URL = `${BASE_URL}/search.json`;

type OpenLibrarySearchDoc = {
  key?: string;
  title?: string;
  author_name?: string[];
  author_key?: string[];
  cover_edition_key?: string;
  first_publish_year?: number;
  cover_i?: number;
  language?: string[];
  subject?: string[];
  publisher?: string[];
  edition_count?: number;
  isbn?: string[];
};

type OpenLibraryDescription =
  | string
  | {
      type?: string;
      value?: string;
    };

type OpenLibraryAuthorRef = {
  author?: {
    key?: string;
  };
  type?: {
    key?: string;
  };
};

type OpenLibraryAuthorJson = {
  key?: string;
  name?: string;
  birth_date?: string;
  death_date?: string;
  alternate_names?: string[];
  bio?: OpenLibraryDescription;
  photos?: number[];
  wikipedia?: string;
  remote_ids?: Record<string, string[] | string>;
};

type OpenLibraryWorkJson = {
  key?: string;
  title?: string;
  subtitle?: string;
  description?: OpenLibraryDescription;
  first_publish_date?: string;
  first_sentence?: OpenLibraryDescription;
  subjects?: string[];
  subject_places?: string[];
  subject_people?: string[];
  subject_times?: string[];
  covers?: number[];
  authors?: OpenLibraryAuthorRef[];
  links?: Array<{ title?: string; url?: string }>;
  excerpts?: Array<{ text?: string; comment?: string }>;
  latest_revision?: number;
  revision?: number;
};

type OpenLibraryEditionsJson = {
  size?: number;
  entries?: OpenLibraryEditionJson[];
  links?: {
    next?: string;
  };
};

type OpenLibraryEditionJson = {
  key?: string;
  title?: string;
  subtitle?: string;
  publishers?: string[];
  publish_date?: string;
  publish_places?: Array<{ name?: string }>;
  number_of_pages?: number;
  physical_format?: string;
  isbn_10?: string[];
  isbn_13?: string[];
  languages?: Array<{ key?: string }>;
  covers?: number[];
  works?: Array<{ key?: string }>;
};

export type OpenLibrarySearchResult = {
  key: string;
  title: string;
  url: string;
  cover: string | null;
  coverEditionKey: string | null;
  authors: string[];
  authorKeys: string[];
  firstPublishYear: number | null;
  publishDate: string | null;
  languages: string[];
  subjects: string[];
  publishers: string[];
  editionCount: number | null;
  numberOfPages: number | null;
  physicalFormat: string | null;
  isbn10: string[];
  isbn13: string[];
  isbns: string[];
};

export type OpenLibrarySearchResponse = {
  query: string;
  url: string;
  numFound: number;
  start: number;
  results: OpenLibrarySearchResult[];
};

export type OpenLibraryAuthor = {
  key: string;
  url: string;
  name: string;
  birthDate: string | null;
  deathDate: string | null;
  alternateNames: string[];
  bio: string | null;
  photo: string | null;
  wikipedia: string | null;
  remoteIds: Record<string, string[] | string>;
};

export type OpenLibraryEdition = {
  key: string;
  url: string;
  title: string | null;
  subtitle: string | null;
  publishDate: string | null;
  publishers: string[];
  publishPlaces: string[];
  numberOfPages: number | null;
  physicalFormat: string | null;
  isbn10: string[];
  isbn13: string[];
  languages: string[];
  cover: string | null;
};

export type OpenLibraryWork = {
  key: string;
  url: string;
  title: string;
  subtitle: string | null;
  description: string | null;
  firstSentence: string | null;
  firstPublishDate: string | null;
  subjects: string[];
  subjectPlaces: string[];
  subjectPeople: string[];
  subjectTimes: string[];
  links: Array<{ title: string; url: string }>;
  excerpts: Array<{ text: string; comment: string | null }>;
  covers: string[];
  authors: OpenLibraryAuthor[];
  editionCount: number;
  editions: OpenLibraryEdition[];
  publishers: string[];
  languages: string[];
  isbn10: string[];
  isbn13: string[];
};

function normalizeWhitespace(value: string) {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function unique<T>(values: T[]) {
  return [...new Set(values)];
}

function asArray<T>(value: T[] | undefined | null) {
  return Array.isArray(value) ? value : [];
}

function parseDescription(value: OpenLibraryDescription | undefined) {
  if (!value) {
    return null;
  }

  if (typeof value === "string") {
    return normalizeWhitespace(value);
  }

  return value.value ? normalizeWhitespace(value.value) : null;
}

function toAbsoluteUrl(path: string) {
  return new URL(path, BASE_URL).toString();
}

function coverUrl(coverId: number | undefined, size: "S" | "M" | "L" = "L") {
  if (!coverId) {
    return null;
  }

  return `https://covers.openlibrary.org/b/id/${coverId}-${size}.jpg`;
}

async function fetchJson<T>(url: string) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "comics-scripts/1.0 (+https://openlibrary.org)"
    }
  });

  if (!response.ok) {
    throw new Error(`Open Library request failed with ${response.status} ${response.statusText}`);
  }

  return (await response.json()) as T;
}

function normalizeSearchResult(doc: OpenLibrarySearchDoc): OpenLibrarySearchResult | null {
  if (!doc.key || !doc.title) {
    return null;
  }

  return {
    key: doc.key,
    title: doc.title,
    url: toAbsoluteUrl(doc.key),
    cover: coverUrl(doc.cover_i),
    coverEditionKey: doc.cover_edition_key ? `/books/${doc.cover_edition_key}` : null,
    authors: unique(asArray(doc.author_name).map(normalizeWhitespace).filter(Boolean)),
    authorKeys: unique(asArray(doc.author_key).map((key) => `/authors/${key}`).filter(Boolean)),
    firstPublishYear: typeof doc.first_publish_year === "number" ? doc.first_publish_year : null,
    publishDate: null,
    languages: unique(asArray(doc.language).map(normalizeWhitespace).filter(Boolean)),
    subjects: unique(asArray(doc.subject).map(normalizeWhitespace).filter(Boolean)),
    publishers: unique(asArray(doc.publisher).map(normalizeWhitespace).filter(Boolean)),
    editionCount: typeof doc.edition_count === "number" ? doc.edition_count : null,
    numberOfPages: null,
    physicalFormat: null,
    isbn10: [],
    isbn13: [],
    isbns: unique(asArray(doc.isbn).map(normalizeWhitespace).filter(Boolean))
  };
}

async function getEditionByKey(bookKeyOrUrl: string) {
  const editionUrl = new URL(bookKeyOrUrl, BASE_URL);
  const pathname = editionUrl.pathname.replace(/\.json$/, "");
  const edition = await fetchJson<OpenLibraryEditionJson>(`${BASE_URL}${pathname}.json`);
  return normalizeEdition(edition);
}

async function getSearchResultPreview(result: OpenLibrarySearchResult) {
  if (result.coverEditionKey) {
    return await getEditionByKey(result.coverEditionKey);
  }

  if (result.editionCount === 1) {
    const editions = await getEditions(result.key, 1);
    return editions[0] ?? null;
  }

  return null;
}

async function enrichSearchResults(results: OpenLibrarySearchResult[]) {
  const previews = await Promise.all(results.map((result) => getSearchResultPreview(result)));

  return results.map((result, index) => {
    const preview = previews[index];
    if (!preview) {
      return result;
    }

    const isbn10 = unique([...result.isbn10, ...preview.isbn10]);
    const isbn13 = unique([...result.isbn13, ...preview.isbn13]);

    return {
      ...result,
      cover: result.cover ?? preview.cover,
      publishDate: result.publishDate ?? preview.publishDate,
      languages: unique([...result.languages, ...preview.languages]),
      publishers: unique([...result.publishers, ...preview.publishers]),
      numberOfPages: result.numberOfPages ?? preview.numberOfPages,
      physicalFormat: result.physicalFormat ?? preview.physicalFormat,
      isbn10,
      isbn13,
      isbns: unique([...result.isbns, ...isbn10, ...isbn13])
    };
  });
}

function normalizeAuthor(author: OpenLibraryAuthorJson): OpenLibraryAuthor {
  const key = author.key ?? "";

  return {
    key,
    url: toAbsoluteUrl(key),
    name: normalizeWhitespace(author.name ?? key),
    birthDate: author.birth_date ? normalizeWhitespace(author.birth_date) : null,
    deathDate: author.death_date ? normalizeWhitespace(author.death_date) : null,
    alternateNames: unique(asArray(author.alternate_names).map(normalizeWhitespace).filter(Boolean)),
    bio: parseDescription(author.bio),
    photo: coverUrl(author.photos?.[0]),
    wikipedia: author.wikipedia ? normalizeWhitespace(author.wikipedia) : null,
    remoteIds: author.remote_ids ?? {}
  };
}

function languageCodeFromKey(key: string) {
  const match = key.match(/\/languages\/(.+)$/);
  return match?.[1] ?? key;
}

function normalizeEdition(edition: OpenLibraryEditionJson): OpenLibraryEdition | null {
  if (!edition.key) {
    return null;
  }

  return {
    key: edition.key,
    url: toAbsoluteUrl(edition.key),
    title: edition.title ? normalizeWhitespace(edition.title) : null,
    subtitle: edition.subtitle ? normalizeWhitespace(edition.subtitle) : null,
    publishDate: edition.publish_date ? normalizeWhitespace(edition.publish_date) : null,
    publishers: unique(asArray(edition.publishers).map(normalizeWhitespace).filter(Boolean)),
    publishPlaces: unique(asArray(edition.publish_places).map((place) => normalizeWhitespace(place.name ?? "")).filter(Boolean)),
    numberOfPages: typeof edition.number_of_pages === "number" ? edition.number_of_pages : null,
    physicalFormat: edition.physical_format ? normalizeWhitespace(edition.physical_format) : null,
    isbn10: unique(asArray(edition.isbn_10).map(normalizeWhitespace).filter(Boolean)),
    isbn13: unique(asArray(edition.isbn_13).map(normalizeWhitespace).filter(Boolean)),
    languages: unique(asArray(edition.languages).map((language) => languageCodeFromKey(language.key ?? "")).filter(Boolean)),
    cover: coverUrl(edition.covers?.[0])
  };
}

async function getEditions(workKey: string, maxPages = 3) {
  const editions: OpenLibraryEdition[] = [];
  let nextUrl: string | null = `${BASE_URL}${workKey}/editions.json`;
  let pageCount = 0;

  while (nextUrl && pageCount < maxPages) {
    const page = await fetchJson<OpenLibraryEditionsJson>(nextUrl);
    for (const entry of asArray(page.entries)) {
      const normalized = normalizeEdition(entry);
      if (normalized) {
        editions.push(normalized);
      }
    }

    nextUrl = page.links?.next ? toAbsoluteUrl(page.links.next) : null;
    pageCount += 1;
  }

  return editions;
}

export async function search(query: string, limit = 10): Promise<OpenLibrarySearchResponse> {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) {
    throw new Error("search query cannot be empty");
  }

  const url = new URL(SEARCH_URL);
  url.searchParams.set("q", trimmedQuery);
  url.searchParams.set("limit", String(limit));

  const response = await fetchJson<{ numFound?: number; start?: number; docs?: OpenLibrarySearchDoc[] }>(url.toString());
  const baseResults = asArray(response.docs)
    .map(normalizeSearchResult)
    .filter((item): item is OpenLibrarySearchResult => Boolean(item));
  const results = await enrichSearchResults(baseResults);

  return {
    query: trimmedQuery,
    url: url.toString(),
    numFound: typeof response.numFound === "number" ? response.numFound : results.length,
    start: typeof response.start === "number" ? response.start : 0,
    results
  };
}

export async function getAuthor(authorKeyOrUrl: string): Promise<OpenLibraryAuthor> {
  const authorUrl = new URL(authorKeyOrUrl, BASE_URL);
  const pathname = authorUrl.pathname.replace(/\.json$/, "");
  const author = await fetchJson<OpenLibraryAuthorJson>(`${BASE_URL}${pathname}.json`);
  return normalizeAuthor(author);
}

export async function getWork(workKeyOrUrl: string): Promise<OpenLibraryWork> {
  const workUrl = new URL(workKeyOrUrl, BASE_URL);
  const pathname = workUrl.pathname.replace(/\.json$/, "");
  const work = await fetchJson<OpenLibraryWorkJson>(`${BASE_URL}${pathname}.json`);
  const editions = await getEditions(pathname);
  const authorKeys = unique(
    asArray(work.authors)
      .map((authorRef) => authorRef.author?.key)
      .filter((key): key is string => Boolean(key))
  );
  const authors = await Promise.all(authorKeys.map((authorKey) => getAuthor(authorKey)));

  return {
    key: work.key ?? pathname,
    url: toAbsoluteUrl(work.key ?? pathname),
    title: normalizeWhitespace(work.title ?? pathname),
    subtitle: work.subtitle ? normalizeWhitespace(work.subtitle) : null,
    description: parseDescription(work.description),
    firstSentence: parseDescription(work.first_sentence),
    firstPublishDate: work.first_publish_date ? normalizeWhitespace(work.first_publish_date) : null,
    subjects: unique(asArray(work.subjects).map(normalizeWhitespace).filter(Boolean)),
    subjectPlaces: unique(asArray(work.subject_places).map(normalizeWhitespace).filter(Boolean)),
    subjectPeople: unique(asArray(work.subject_people).map(normalizeWhitespace).filter(Boolean)),
    subjectTimes: unique(asArray(work.subject_times).map(normalizeWhitespace).filter(Boolean)),
    links: asArray(work.links)
      .map((link) => ({
        title: normalizeWhitespace(link.title ?? ""),
        url: link.url ? normalizeWhitespace(link.url) : ""
      }))
      .filter((link) => link.title && link.url),
    excerpts: asArray(work.excerpts)
      .map((excerpt) => ({
        text: normalizeWhitespace(excerpt.text ?? ""),
        comment: excerpt.comment ? normalizeWhitespace(excerpt.comment) : null
      }))
      .filter((excerpt) => excerpt.text),
    covers: unique(asArray(work.covers).map((coverId) => coverUrl(coverId)).filter((url): url is string => Boolean(url))),
    authors,
    editionCount: editions.length,
    editions,
    publishers: unique(editions.flatMap((edition) => edition.publishers)),
    languages: unique(editions.flatMap((edition) => edition.languages)),
    isbn10: unique(editions.flatMap((edition) => edition.isbn10)),
    isbn13: unique(editions.flatMap((edition) => edition.isbn13))
  };
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);

  if (!command) {
    console.error("Usage: bun run sources/openlibrary.ts <search|getWork|getAuthor> <query-or-key>");
    process.exit(1);
  }

  if (command === "search") {
    const query = rest.join(" ").trim();
    if (!query) {
      console.error("Usage: bun run sources/openlibrary.ts search <query>");
      process.exit(1);
    }

    console.log(JSON.stringify(await search(query), null, 2));
    return;
  }

  if (command === "getWork") {
    const key = rest.join(" ").trim();
    if (!key) {
      console.error("Usage: bun run sources/openlibrary.ts getWork <work-key-or-url>");
      process.exit(1);
    }

    console.log(JSON.stringify(await getWork(key), null, 2));
    return;
  }

  if (command === "getAuthor") {
    const key = rest.join(" ").trim();
    if (!key) {
      console.error("Usage: bun run sources/openlibrary.ts getAuthor <author-key-or-url>");
      process.exit(1);
    }

    console.log(JSON.stringify(await getAuthor(key), null, 2));
    return;
  }

  console.log(JSON.stringify(await search([command, ...rest].join(" ").trim()), null, 2));
}

if (import.meta.main) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  });
}
