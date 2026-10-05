"use client";
export default function LogoutButton() {
  return (
    <button onClick={async () => { await fetch("/api/auth/logout", { method: "POST" }); window.location.href = "/"; }} className="text-xs text-slate-500 underline hover:text-slate-800">
      Lock
    </button>
  );
}
