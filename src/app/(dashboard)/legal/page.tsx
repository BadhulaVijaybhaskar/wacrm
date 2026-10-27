import type { Metadata } from "next";
import Link from "next/link";
import { THIRD_PARTY_NOTICE } from "@/lib/legal/notice";

export const metadata: Metadata = {
  title: "Legal notices",
};

export default function LegalNoticesPage() {
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
        {THIRD_PARTY_NOTICE}
      </pre>
    </div>
  );
}
