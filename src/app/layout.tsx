import type { Metadata } from "next";
import type { ReactNode } from "react";
import LoginForm from "@/components/LoginForm";
import LogoutButton from "@/components/LogoutButton";
import Nav from "@/components/Nav";
import { authRequired, isAuthed } from "@/lib/server/auth";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sahaay — your business's decision engine",
  description: "Know what needs attention. Know why. Decide with confidence.",
};
export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: ReactNode }) {
  const authed = await isAuthed();
  const open = !authRequired();
  return (
    <html lang="en">
      <body className="bg-slate-50 text-slate-900 antialiased">
        {!authed ? (
          <LoginForm />
        ) : (
          <div className="min-h-screen md:flex">
            <aside className="border-b border-slate-200 bg-white md:sticky md:top-0 md:h-screen md:w-64 md:shrink-0 md:overflow-y-auto md:border-b-0 md:border-r">
              <div className="flex items-center justify-between px-5 pt-4 md:block">
                <div>
                  <div className="text-xl font-bold tracking-tight text-indigo-700">Sahaay</div>
                  <div className="hidden text-[11px] leading-tight text-slate-500 md:block">Know what needs attention.<br />Know why. Decide with confidence.</div>
                </div>
                <div className="md:mt-3 md:flex md:items-center md:justify-between">
                  {open ? <span title="Set SAHAAY_ACCESS_CODE to require login" className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">OPEN MODE</span> : <LogoutButton />}
                </div>
              </div>
              <Nav />
            </aside>
            <main className="min-w-0 flex-1 px-4 py-6 md:px-8 md:py-8">
              <div className="mx-auto max-w-5xl">{children}</div>
            </main>
          </div>
        )}
      </body>
    </html>
  );
}
