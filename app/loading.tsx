import { AppLogo } from "@/components/app-logo";

/**
 * Next.js's route-level `loading.tsx` boundary — shown while any route
 * segment's Server Component data is still resolving. Deliberately just the
 * brand mark, no "Cargando..."/status text: a purist loading state that
 * reads as part of the app's own chrome rather than a generic spinner
 * screen. Same `#FDFCF9` cream as the auth-flow screens
 * (`components/auth-page-shell.tsx`) for visual continuity between "loading"
 * and "authenticating" states.
 */
export default function Loading() {
  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-[#FDFCF9]">
      <AppLogo className="animate-logo-breathe size-14" />
    </div>
  );
}
