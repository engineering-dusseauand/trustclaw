import Link from "next/link";

export default function AuthErrorPage() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-center">
        <h1 className="text-xl font-medium text-foreground mb-4">
          Authentication Error
        </h1>
        <p className="text-muted-foreground mb-4">
          Something went wrong during authentication.
        </p>
        <Link href="/login" className="text-primary hover:underline">
          Back to Login
        </Link>
      </div>
    </div>
  );
}
