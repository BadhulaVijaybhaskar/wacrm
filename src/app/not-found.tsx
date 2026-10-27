import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 text-center">
      <p className="text-sm font-semibold tracking-wide text-primary">
        Astra Chat
      </p>
      <h1 className="mt-3 text-2xl font-semibold text-foreground">
        Page not found
      </h1>
      <p className="mt-2 max-w-sm text-sm text-muted-foreground">
        The page you requested does not exist or is no longer available.
      </p>
      <Link
        href="/dashboard"
        className="mt-6 text-sm font-medium text-primary hover:text-primary/80"
      >
        Back to dashboard
      </Link>
    </div>
  );
}
