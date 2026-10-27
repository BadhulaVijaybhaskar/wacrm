import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Legal notices",
};

async function readNotice(): Promise<string> {
  const candidates = [
    // Shipped with the standalone Docker image via `public/`.
    path.join(process.cwd(), "public", "legal", "NOTICE.txt"),
    // Repo root during `next dev` / local `next start`.
    path.join(process.cwd(), "NOTICE"),
  ];
  for (const candidate of candidates) {
    try {
      return await readFile(candidate, "utf8");
    } catch {
      // try next
    }
  }
  return "Third-party license notices are unavailable in this build.";
}

export default async function LegalNoticesPage() {
  const notice = await readNotice();

  return (
    <div className="mx-auto max-w-3xl px-1 py-2">
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          Legal notices
        </h1>
        <Link
          href="/dashboard"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          Back
        </Link>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        Third-party open-source licenses included with this product.
      </p>
      <pre className="mt-6 max-h-[70vh] overflow-auto rounded-lg border border-border bg-muted/40 p-4 text-xs leading-relaxed whitespace-pre-wrap text-foreground">
        {notice}
      </pre>
    </div>
  );
}
