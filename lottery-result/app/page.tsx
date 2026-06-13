"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

// ── Types ──────────────────────────────────────────────────────────────────
interface ItemResult {
  item: string;
  rank: number;
}

interface Person {
  email: string;
  name: string;
  lineId: string;
  items: ItemResult[];
}

interface PublicResultRow {
  maskedEmail: string;
  maskedLineId: string;
  items: ItemResult[];
  won: boolean;
  disqualified: boolean;
  disqualifiedReason?: string;
}

interface DisqualifiedPerson {
  email: string;
  name: string;
  lineId: string;
  disqualifiedReason: string;
}

interface ResultsData {
  generatedAt: string;
  seed: number;
  results: Person[];
  disqualified: DisqualifiedPerson[];
}

// ── Helpers ────────────────────────────────────────────────────────────────
function Badge({ label, color = "teal" }: { label: string; color?: "teal" | "amber" | "red" }) {
  const styles = {
    teal: "bg-teal-100 text-teal-800",
    amber: "bg-amber-100 text-amber-800",
    red: "bg-red-100 text-red-700",
  };
  return (
    <span className={`inline-block text-xs font-semibold px-2.5 py-0.5 rounded-full ${styles[color]}`}>
      {label}
    </span>
  );
}

function ItemCard({ item, rank }: { item: string; rank: number }) {
  return (
    <div className="flex items-center gap-3 bg-white border border-teal-100 rounded-xl px-4 py-3 shadow-sm">
      <span className="text-2xl">🎁</span>
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-gray-800 truncate">{item}</p>
        <p className="text-xs text-gray-400">อันดับที่ {rank} ของคุณ</p>
      </div>
    </div>
  );
}

function maskText(value: string, visible: number) {
  if (!value) return "";
  const keep = Math.min(visible, value.length);
  return value.slice(0, keep) + "*".repeat(Math.min(4, Math.max(0, value.length - keep)));
}

function maskEmail(email: string) {
  if (!email.includes("@")) return maskText(email, 4);
  const [local, domain] = email.split("@", 1 + 1);
  return `${maskText(local, 4)}@${maskText(domain ?? "", 2)}`;
}

// ── Search Tab ─────────────────────────────────────────────────────────────
function SearchTab({ data }: { data: ResultsData }) {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<Person | DisqualifiedPerson | null | "not-found">(null);
  const [isDisqualified, setIsDisqualified] = useState(false);

  function handleSearch() {
    const q = query.trim().toLowerCase();
    if (!q) return;

    const found = data.results.find(
      (p) =>
        p.email.toLowerCase() === q ||
        p.lineId.toLowerCase() === q ||
        p.lineId.toLowerCase().replace(/^@/, "") === q.replace(/^@/, "")
    );
    if (found) { setResult(found); setIsDisqualified(false); return; }

    const dq = data.disqualified?.find(
      (p) =>
        p.email.toLowerCase() === q ||
        p.lineId.toLowerCase() === q ||
        p.lineId.toLowerCase().replace(/^@/, "") === q.replace(/^@/, "")
    );
    if (dq) { setResult(dq); setIsDisqualified(true); return; }

    setResult("not-found");
    setIsDisqualified(false);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") handleSearch();
  }

  const person = result && result !== "not-found" && !isDisqualified ? result as Person : null;
  const dqPerson = result && result !== "not-found" && isDisqualified ? result as DisqualifiedPerson : null;
  const reasonLabel = dqPerson?.disqualifiedReason === "cheat_flag"
    ? "ให้ข้อมูลไม่ถูกต้อง (ถูกตัดสิทธิ์)"
    : "จัดอันดับซ้ำกัน";

  return (
    <div className="max-w-lg mx-auto mt-8 space-y-6">
      <div className="bg-white rounded-2xl shadow-md p-6 space-y-4">
        <p className="text-sm text-gray-500">
          ใส่ <strong>Email</strong> หรือ <strong>LINE ID</strong> เพื่อเช็คว่าได้อะไรนะ 👀
        </p>
        <div className="flex gap-2">
          <input
            type="text"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setResult(null); }}
            onKeyDown={handleKeyDown}
            placeholder="เช่น you@email.com หรือ @lineid"
            className="flex-1 border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
          />
          <button
            onClick={handleSearch}
            className="bg-teal-500 hover:bg-teal-600 text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition-colors"
          >
            เช็คเลย
          </button>
        </div>
      </div>

      {result === "not-found" && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-6 text-center">
          <p className="text-3xl mb-2">😔</p>
          <p className="font-semibold text-red-700">ไม่เจอข้อมูลนะ</p>
          <p className="text-sm text-red-500 mt-1">ลองเช็ค Email หรือ LINE ID ใหม่อีกทีนะ</p>
        </div>
      )}

      {dqPerson && (
        <div className="bg-orange-50 border border-orange-200 rounded-2xl p-6 space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-orange-100 flex items-center justify-center text-xl font-bold text-orange-500">
              {dqPerson.name.charAt(0).toUpperCase()}
            </div>
            <div>
              <p className="font-bold text-gray-800 text-lg">{dqPerson.name}</p>
              <p className="text-xs text-gray-400">{dqPerson.email}</p>
            </div>
          </div>
          <div className="bg-orange-100 rounded-xl p-4 text-center">
            <p className="text-2xl mb-1">⚠️</p>
            <p className="text-orange-700 font-semibold">ถูกตัดสิทธิ์แล้วนะ</p>
            <p className="text-sm text-orange-600 mt-1">เหตุผล: {reasonLabel}</p>
          </div>
        </div>
      )}

      {person && (
        <div className="bg-white rounded-2xl shadow-md p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-teal-100 flex items-center justify-center text-xl font-bold text-teal-600">
              {person.name.charAt(0).toUpperCase()}
            </div>
            <div>
              <p className="font-bold text-gray-800 text-lg">{person.name}</p>
              <p className="text-xs text-gray-400">{person.email}</p>
            </div>
          </div>

          {person.items.length === 0 ? (
            <div className="bg-gray-50 rounded-xl p-4 text-center">
              <p className="text-2xl mb-1">🎲</p>
              <p className="text-gray-600 font-medium">รอบนี้ยังไม่ได้นะ</p>
              {/* <p className="text-sm text-gray-400 mt-1">ขอบคุณที่ร่วมสนุกด้วยนะ 🙏</p> */}
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-gray-600">ของที่ได้ 🎉</p>
                <Badge label={`${person.items.length} ชิ้น`} color="teal" />
              </div>
              {person.items.map((r, i) => (
                <ItemCard key={i} item={r.item} rank={r.rank} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── All Results Tab ────────────────────────────────────────────────────────
function AllResultsTab({ data }: { data: ResultsData }) {
  const [filterWon, setFilterWon] = useState<"all" | "won" | "not-won" | "disqualified">("all");
  const [search, setSearch] = useState("");

  const publicRows: PublicResultRow[] = [
    ...data.results.map((p) => ({
      maskedEmail: maskEmail(p.email),
      maskedLineId: maskText(p.lineId, 2),
      items: p.items,
      won: p.items.length > 0,
      disqualified: false,
    })),
    ...data.disqualified.map((p) => ({
      maskedEmail: maskEmail(p.email),
      maskedLineId: maskText(p.lineId, 2),
      items: [],
      won: false,
      disqualified: true,
      disqualifiedReason: p.disqualifiedReason,
    })),
  ];

  const filtered = publicRows.filter((p) => {
    if (filterWon === "won" && (!p.won || p.disqualified)) return false;
    if (filterWon === "not-won" && (p.won || p.disqualified)) return false;
    if (filterWon === "disqualified" && !p.disqualified) return false;
    if (search && !p.maskedEmail.toLowerCase().includes(search.toLowerCase()) &&
        !p.maskedLineId.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const filters: { key: typeof filterWon; label: string }[] = [
    { key: "all", label: "ทั้งหมด" },
    { key: "won", label: "✅ ได้ของ" },
    { key: "not-won", label: "🎲 ยังไม่ได้" },
    { key: "disqualified", label: "⚠️ ถูกตัดสิทธิ์" },
  ];

  return (
    <div className="max-w-2xl mx-auto mt-8 space-y-4">
      <div className="bg-white rounded-2xl shadow-md p-4 flex flex-col sm:flex-row gap-3">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="ค้นหา email หรือ LINE ID..."
          className="flex-1 border border-gray-200 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
        />
        <div className="flex gap-2 flex-wrap">
          {filters.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilterWon(f.key)}
              className={`text-xs font-semibold px-3 py-2 rounded-xl transition-colors ${
                filterWon === f.key
                  ? f.key === "disqualified"
                    ? "bg-orange-400 text-white"
                    : "bg-teal-500 text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <p className="text-xs text-gray-400 text-right px-1">
        แสดง {filtered.length} / {publicRows.length} รายการ • email และ LINE ID ถูกซ่อนบางส่วน
      </p>

      <div className="space-y-3">
        {filtered.map((p, i) => (
          <div
            key={i}
            className={`bg-white rounded-2xl shadow-sm border p-4 ${
              p.disqualified
                ? "border-orange-200 bg-orange-50/30"
                : p.won
                ? "border-teal-100"
                : "border-gray-100"
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex flex-col gap-0.5">
                <span className="font-semibold text-gray-700 text-sm">{p.maskedEmail}</span>
                <span className="text-xs text-gray-400">LINE: {p.maskedLineId || "-"}</span>
              </div>
              {p.disqualified ? (
                <Badge
                  label={p.disqualifiedReason === "cheat_flag" ? "⚠️ ถูกตัดสิทธิ์" : "⚠️ อันดับซ้ำ"}
                  color="red"
                />
              ) : p.won ? (
                <Badge label={`${p.items.length} ชิ้น`} color="teal" />
              ) : (
                <span className="text-xs text-gray-400">ยังไม่ได้รับ</span>
              )}
            </div>
            {p.items.length > 0 && (
              <div className="mt-2 space-y-1.5">
                {p.items.map((r, j) => (
                  <div key={j} className="flex items-center gap-2 text-sm text-gray-600 bg-teal-50 rounded-lg px-3 py-1.5">
                    <span>🎁</span>
                    <span className="flex-1 truncate">{r.item}</span>
                    <span className="text-xs text-gray-400 shrink-0">อันดับ #{r.rank}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────
export default function Home() {
  const [tab, setTab] = useState<"search" | "all">("search");
  const [data, setData] = useState<ResultsData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/results.json")
      .then((r) => r.json())
      .then(setData)
      .catch(() => setError("ไม่สามารถโหลดข้อมูลได้"));
  }, []);

  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <div className="bg-gradient-to-r from-teal-500 to-cyan-400 text-white px-4 py-8 text-center shadow-lg">
        <div className="flex justify-center mb-3">
          <Image
            src="/logo.jpeg"
            alt="Neptune Lottery Logo"
            width={80}
            height={80}
            loading="eager"
            className="rounded-full border-4 border-white shadow-lg object-cover"
          />
        </div>
        <h1 className="text-2xl font-extrabold tracking-tight">Neptune Lottery (รอบวันเสาร์ที่ 13 มิ.ย.)</h1>
        <p className="text-sm text-teal-50 mt-1">เช็คผลสุ่มที่นี่เลย! 🎁</p>
      </div>

      <div className="flex justify-center mt-6 px-4">
        <div className="inline-flex bg-white rounded-2xl shadow p-1 gap-1">
          {(["search", "all"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-6 py-2 text-sm font-semibold rounded-xl transition-all ${
                tab === t
                  ? "bg-teal-500 text-white shadow"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              {t === "search" ? "🔍 เช็คผลของฉัน" : "📋 ดูผลทั้งหมด"}
            </button>
          ))}
        </div>
      </div>

      <main className="px-4 pb-12">
        {error && (
          <p className="text-center text-red-500 mt-10">{error}</p>
        )}
        {!data && !error && (
          <p className="text-center text-gray-400 mt-10 animate-pulse">รอแป๊บนึงนะ... 🌊</p>
        )}
        {data && tab === "search" && <SearchTab data={data} />}
        {data && tab === "all" && <AllResultsTab data={data} />}
      </main>
    </div>
  );
}
