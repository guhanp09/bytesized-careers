import { useState, useEffect } from "react";
import {
  Search, Bookmark, Share2, MapPin, DollarSign, Star, ArrowRight,
  ChevronRight, Zap, Users, UserCheck, Briefcase, CheckCircle,
  TrendingUp, Shield, Clock, Edit3, Palette, FileText, Image,
  Mic, Film, BarChart, Quote, ChevronDown, Bell, Plus, Mail,
  Sparkles,
} from "lucide-react";

// ─── Data ────────────────────────────────────────────────────────────────────

const navLinks = ["Browse Jobs", "Browse Talent", "Pricing", "How it Works", "Blog"];

const jobListings = [
  { id: 1, channel: "Guhan Punathottaman", subscribers: "21K subscribers", time: "3 days ago", title: "SESEWWWWWW", pay: "₹33 – ₹222 per project", experience: "Any", location: "Remote", tags: [], avatar: "GP", color: "#E8A87C", category: "Editing" },
  { id: 2, channel: "Guhan Punathottaman", subscribers: "21K subscribers", time: "11 days ago", title: "NOTIFICATION TEST", pay: "Flexible", experience: "Any", location: "Remote", tags: [], avatar: "GP", color: "#E8A87C", category: "Design" },
  { id: 3, channel: "Content creator", subscribers: "Subscribers hidden", time: "6 hrs ago", title: "PR NOTIF JOB 17B134244B092", pay: "Flexible", experience: "Any", location: "Remote", tags: ["Premiere"], avatar: "CC", color: "#6C63FF", category: "Editing" },
];

const talentListings = [
  { id: 1, name: "Arjun Mehta", handle: "@arjunedits", title: "YouTube Video Editor", rate: "₹2,500/project", experience: "3 years", location: "Remote", tags: ["Premiere", "After Effects"], avatar: "AM", color: "#1769FF", rating: 4.9 },
  { id: 2, name: "Priya Sharma", handle: "@priyadesigns", title: "Thumbnail Designer", rate: "₹800/thumbnail", experience: "2 years", location: "Remote", tags: ["Photoshop", "Figma"], avatar: "PS", color: "#10B981", rating: 4.8 },
  { id: 3, name: "Rahul Das", handle: "@rahulwrites", title: "Script Writer", rate: "₹600/script", experience: "4 years", location: "Remote", tags: ["Research", "SEO"], avatar: "RD", color: "#F59E0B", rating: 4.7 },
];

const stats = [
  { label: "Active Jobs", value: "2,400+" },
  { label: "Verified Creators", value: "1,800+" },
  { label: "Hires Made", value: "12,000+" },
  { label: "Countries", value: "40+" },
];

const categories = ["Editing", "Design", "Writing", "Thumbnails", "Shorts", "Motion Graphics", "Voice Over", "Research"];

const featuredCategories = [
  { icon: Film, label: "Video Editing", count: "840 jobs", color: "#1769FF", bg: "rgba(23,105,255,0.12)" },
  { icon: Palette, label: "Design", count: "520 jobs", color: "#8B5CF6", bg: "rgba(139,92,246,0.12)" },
  { icon: FileText, label: "Writing", count: "390 jobs", color: "#10B981", bg: "rgba(16,185,129,0.12)" },
  { icon: Image, label: "Thumbnails", count: "280 jobs", color: "#F59E0B", bg: "rgba(245,158,11,0.12)" },
  { icon: Film, label: "Shorts", count: "210 jobs", color: "#EF4444", bg: "rgba(239,68,68,0.12)" },
  { icon: Edit3, label: "Motion Graphics", count: "175 jobs", color: "#0EA5E9", bg: "rgba(14,165,233,0.12)" },
  { icon: Mic, label: "Voice Over", count: "140 jobs", color: "#EC4899", bg: "rgba(236,72,153,0.12)" },
  { icon: BarChart, label: "Channel Mgr", count: "95 jobs", color: "#6366F1", bg: "rgba(99,102,241,0.12)" },
];

const howItWorks = [
  { step: "01", icon: UserCheck, title: "Create your free profile", description: "Sign up in under 2 minutes. List your skills, set your rates, and showcase your portfolio to thousands of creators." },
  { step: "02", icon: Search, title: "Browse & apply to jobs", description: "Filter by category, pay range, and experience level. Apply with one click — no cover letter required." },
  { step: "03", icon: CheckCircle, title: "Get hired & get paid", description: "Connect directly with creators. Agree on terms and deliver your work. Secure and straightforward." },
];

const testimonials = [
  { text: "Found my first YouTube editing client within 48 hours of signing up. The platform is exactly what the creator economy needed.", name: "Vikram S.", role: "Video Editor · 3 years", avatar: "VS", color: "#1769FF", hires: "12 hires" },
  { text: "As a channel owner, I was spending weeks searching for reliable editors. CreatorJobs cut that down to a single afternoon.", name: "Meera K.", role: "Creator · 180K subscribers", avatar: "MK", color: "#10B981", hires: "8 hires made" },
  { text: "The talent pool here actually understands YouTube — they know retention curves, thumbnails, everything. Game changer.", name: "Ankit R.", role: "Finance Creator · 95K subs", avatar: "AR", color: "#F59E0B", hires: "5 hires made" },
];

const whyUs = [
  { icon: Shield, title: "Creator-verified profiles", description: "Every talent profile is reviewed. No bots, no fake accounts — just real creators ready to work." },
  { icon: TrendingUp, title: "Built for YouTube scale", description: "From 1K to 10M subscribers, our job categories are designed specifically for the creator economy." },
  { icon: Clock, title: "Hire in 24 hours", description: "Post a job and receive applications the same day. Most creators are hired within 24 hours." },
  { icon: Zap, title: "No middlemen", description: "Connect directly with talent. No platform fees on your first hire, ever." },
];

const brandLogos = ["TechChannel", "EduHindi", "Finance Creator", "Motivation Shorts", "Science Visuals", "Startup Stories", "History Deep Dives", "Content Creator"];

const liveActivity = [
  { avatar: "AM", color: "#1769FF", text: "Arjun M. was hired as Video Editor", time: "2m ago" },
  { avatar: "PS", color: "#10B981", text: "Priya S. applied to Thumbnail Designer", time: "5m ago" },
  { avatar: "TC", color: "#F59E0B", text: "TechChannel posted a new editing job", time: "9m ago" },
  { avatar: "RD", color: "#8B5CF6", text: "Rahul D. joined as Script Writer", time: "14m ago" },
];

const faqs = [
  { q: "Is CreatorJobs free to use?", a: "Yes — signing up, browsing jobs, and applying is completely free for talent. Creators can post their first job at no cost." },
  { q: "Do I need a large following to hire?", a: "Not at all. We have creators from 1K to 10M subscribers hiring on the platform. Talent on CreatorJobs works with channels of all sizes." },
  { q: "How quickly can I get hired?", a: "Most talent receive their first application response within 24–48 hours. Many complete their first hire within a week of joining." },
  { q: "What makes this different from Fiverr or Upwork?", a: "CreatorJobs is built exclusively for the YouTube and short-form video world. Every job category, filter, and skill tag maps to real creator workflows." },
  { q: "How are payments handled?", a: "Payment terms are agreed directly between creators and talent. We provide guidance on standard rates but don't intermediate transactions." },
];

const comparisons = [
  { feature: "YouTube-specific categories", us: true, fiverr: false, upwork: false },
  { feature: "Creator-verified profiles", us: true, fiverr: false, upwork: false },
  { feature: "Free first hire", us: true, fiverr: false, upwork: false },
  { feature: "No listing fees", us: true, fiverr: true, upwork: false },
  { feature: "Direct messaging", us: true, fiverr: true, upwork: true },
  { feature: "2-sided marketplace", us: true, fiverr: false, upwork: false },
];

// ─── Sub-components ────────────────────────────────────────────────────────

function Av({ initials, color, size = "md" }: { initials: string; color: string; size?: "sm" | "md" | "lg" }) {
  const sz = size === "sm" ? "w-8 h-8 text-xs" : size === "lg" ? "w-12 h-12 text-base" : "w-10 h-10 text-sm";
  return (
    <div className={`${sz} rounded-full flex items-center justify-center font-bold text-white flex-shrink-0`} style={{ backgroundColor: color }}>
      {initials}
    </div>
  );
}

function Tag({ label }: { label: string }) {
  return (
    <span className="px-2 py-0.5 text-xs font-medium rounded-md text-[#7EB3FF] border border-[#1769FF]/25" style={{ background: "rgba(23,105,255,0.12)" }}>
      {label}
    </span>
  );
}

function JobCard({ job }: { job: typeof jobListings[0] }) {
  const [saved, setSaved] = useState(false);
  return (
    <div className="rounded-2xl border border-white/[0.07] p-5 flex flex-col gap-3 hover:border-[#1769FF]/40 hover:shadow-xl hover:shadow-[#1769FF]/10 transition-all duration-200 group cursor-pointer" style={{ background: "#161A21" }}>
      <div className="flex items-start gap-3">
        <Av initials={job.avatar} color={job.color} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-[#F0F2F5] truncate">{job.channel}</p>
          <p className="text-xs text-[#8B8FA8]">{job.subscribers} · {job.time}</p>
        </div>
        <span className="text-xs px-2 py-0.5 rounded-full font-medium text-[#7EB3FF] border border-[#1769FF]/25" style={{ background: "rgba(23,105,255,0.12)" }}>{job.category}</span>
      </div>
      <h3 className="text-sm font-bold text-[#F0F2F5] leading-snug group-hover:text-[#1769FF] transition-colors line-clamp-2">{job.title}</h3>
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-1.5 text-xs text-[#8B8FA8]"><DollarSign className="w-3.5 h-3.5 text-[#1769FF] flex-shrink-0" /><span>{job.pay}</span></div>
        <div className="flex items-center gap-1.5 text-xs text-[#8B8FA8]"><Star className="w-3.5 h-3.5 text-[#1769FF] flex-shrink-0" /><span>Experience: {job.experience}</span></div>
        <div className="flex items-center gap-1.5 text-xs text-[#8B8FA8]"><MapPin className="w-3.5 h-3.5 text-[#1769FF] flex-shrink-0" /><span>{job.location}</span></div>
      </div>
      {job.tags.length > 0 && <div className="flex flex-wrap gap-1.5">{job.tags.map((t) => <Tag key={t} label={t} />)}</div>}
      <div className="flex items-center justify-between pt-2 border-t border-white/[0.06] mt-auto">
        <button className="text-xs font-semibold text-[#1769FF] hover:underline flex items-center gap-1">Apply now <ChevronRight className="w-3.5 h-3.5" /></button>
        <div className="flex items-center gap-1">
          <button onClick={(e) => { e.stopPropagation(); setSaved(!saved); }} className={`p-1.5 rounded-lg transition-colors ${saved ? "text-[#1769FF]" : "text-[#8B8FA8] hover:text-[#1769FF]"}`} style={saved ? { background: "rgba(23,105,255,0.15)" } : {}}>
            <Bookmark className="w-3.5 h-3.5" fill={saved ? "currentColor" : "none"} />
          </button>
          <button className="p-1.5 rounded-lg text-[#8B8FA8] hover:text-[#1769FF] transition-colors"><Share2 className="w-3.5 h-3.5" /></button>
        </div>
      </div>
    </div>
  );
}

function TalentCard({ talent }: { talent: typeof talentListings[0] }) {
  return (
    <div className="rounded-2xl border border-white/[0.07] p-5 flex flex-col gap-3 hover:border-[#1769FF]/40 hover:shadow-xl hover:shadow-[#1769FF]/10 transition-all duration-200 group cursor-pointer" style={{ background: "#161A21" }}>
      <div className="flex items-start gap-3">
        <Av initials={talent.avatar} color={talent.color} size="lg" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-[#F0F2F5]">{talent.name}</p>
          <p className="text-xs text-[#8B8FA8]">{talent.handle}</p>
          <div className="flex items-center gap-1 mt-0.5"><span className="text-yellow-400 text-xs">★</span><span className="text-xs font-semibold text-[#F0F2F5]">{talent.rating}</span></div>
        </div>
      </div>
      <h3 className="text-sm font-bold text-[#F0F2F5] group-hover:text-[#1769FF] transition-colors">{talent.title}</h3>
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-1.5 text-xs text-[#8B8FA8]"><DollarSign className="w-3.5 h-3.5 text-[#1769FF] flex-shrink-0" /><span>{talent.rate}</span></div>
        <div className="flex items-center gap-1.5 text-xs text-[#8B8FA8]"><Star className="w-3.5 h-3.5 text-[#1769FF] flex-shrink-0" /><span>Experience: {talent.experience}</span></div>
        <div className="flex items-center gap-1.5 text-xs text-[#8B8FA8]"><MapPin className="w-3.5 h-3.5 text-[#1769FF] flex-shrink-0" /><span>{talent.location}</span></div>
      </div>
      <div className="flex flex-wrap gap-1.5">{talent.tags.map((t) => <Tag key={t} label={t} />)}</div>
      <button className="mt-auto w-full py-2 rounded-xl border border-[#1769FF]/50 text-[#7EB3FF] text-sm font-semibold hover:bg-[#1769FF] hover:text-white hover:border-[#1769FF] transition-all duration-150">
        View Profile
      </button>
    </div>
  );
}

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <button
      onClick={() => setOpen(!open)}
      className="w-full text-left rounded-xl border border-white/[0.07] p-5 transition-all hover:border-[#1769FF]/30 cursor-pointer"
      style={{ background: "#161A21" }}
    >
      <div className="flex items-center justify-between gap-4">
        <span className="text-sm font-semibold text-[#F0F2F5]">{q}</span>
        <ChevronDown className={`w-4 h-4 text-[#1769FF] flex-shrink-0 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </div>
      {open && <p className="mt-3 text-sm text-[#8B8FA8] leading-relaxed border-t border-white/[0.06] pt-3">{a}</p>}
    </button>
  );
}

// ─── Live activity toast ──────────────────────────────────────────────────────

function LiveActivityFeed() {
  const [idx, setIdx] = useState(0);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const interval = setInterval(() => {
      setVisible(false);
      setTimeout(() => {
        setIdx((i) => (i + 1) % liveActivity.length);
        setVisible(true);
      }, 400);
    }, 4000);
    return () => clearInterval(interval);
  }, []);

  const item = liveActivity[idx];
  return (
    <div
      className={`fixed bottom-6 left-6 z-50 flex items-center gap-3 px-4 py-3 rounded-2xl border border-white/[0.08] shadow-2xl shadow-black/60 transition-all duration-400 max-w-xs ${visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2"}`}
      style={{ background: "#1C2028" }}
    >
      <div className="relative">
        <Av initials={item.avatar} color={item.color} size="sm" />
        <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-green-500 border-2 border-[#1C2028]" />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-[#F0F2F5] font-medium leading-snug">{item.text}</p>
        <p className="text-xs text-[#8B8FA8] mt-0.5">{item.time}</p>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function App() {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<"talent" | "creator">("talent");
  const [email, setEmail] = useState("");

  return (
    <div className="min-h-screen font-['Inter',sans-serif]" style={{ background: "#0D0F12", color: "#F0F2F5" }}>

      <LiveActivityFeed />

      {/* ── Navbar ── */}
      <nav className="border-b border-white/[0.07] sticky top-0 z-40 backdrop-blur-md" style={{ background: "rgba(13,15,18,0.9)" }}>
        <div className="max-w-7xl mx-auto px-6 h-14 flex items-center gap-8">
          <div className="flex items-center gap-2 flex-shrink-0">
            <div className="w-7 h-7 rounded-lg bg-[#1769FF] flex items-center justify-center">
              <Zap className="w-4 h-4 text-white" fill="white" />
            </div>
            <span className="font-bold text-[15px] text-[#F0F2F5] tracking-tight">CreatorJobs</span>
          </div>
          <div className="hidden md:flex items-center gap-6 flex-1">
            {navLinks.map((link) => (
              <a key={link} href="#" className="text-sm text-[#8B8FA8] hover:text-[#F0F2F5] transition-colors font-medium">{link}</a>
            ))}
          </div>
          <div className="flex items-center gap-2 ml-auto flex-shrink-0">
            <button className="relative w-8 h-8 rounded-lg flex items-center justify-center text-[#8B8FA8] hover:text-[#F0F2F5] transition-colors" style={{ background: "#1C2028" }}>
              <Bell size={16} />
              <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 bg-[#1769FF] rounded-full" />
            </button>
            <button className="px-4 py-1.5 text-sm font-semibold text-[#8B8FA8] hover:text-[#F0F2F5] transition-colors">Sign In</button>
            <button className="flex items-center gap-1.5 px-4 py-1.5 bg-[#1769FF] text-white text-sm font-semibold rounded-lg hover:bg-[#1357D4] transition-colors shadow-md shadow-[#1769FF]/30">
              <Plus size={14} /> Post a Job
            </button>
          </div>
        </div>
      </nav>

      {/* ── NEW: Announcement banner ── */}
      <div className="border-b border-white/[0.06]" style={{ background: "rgba(23,105,255,0.08)" }}>
        <div className="max-w-7xl mx-auto px-6 py-2.5 flex items-center justify-center gap-2">
          <Sparkles className="w-3.5 h-3.5 text-[#7EB3FF]" />
          <span className="text-xs font-medium text-[#7EB3FF]">New: Talent can now create portfolios with video embeds — <a href="#" className="underline underline-offset-2 font-semibold">learn more →</a></span>
        </div>
      </div>

      {/* ── Hero ── */}
      <section className="border-b border-white/[0.07] overflow-hidden" style={{ background: "#0D0F12" }}>
        <div className="max-w-7xl mx-auto px-6 py-16 md:py-24">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div className="flex flex-col gap-6">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full w-fit border border-[#1769FF]/25" style={{ background: "rgba(23,105,255,0.1)" }}>
                <span className="w-1.5 h-1.5 rounded-full bg-[#1769FF] animate-pulse" />
                <span className="text-xs font-semibold text-[#7EB3FF]">Jobs and talent in one market</span>
              </div>
              <h1 className="text-4xl md:text-5xl font-bold text-[#F0F2F5] leading-[1.15] tracking-tight">
                The next generation of media is{" "}
                <span className="text-[#1769FF]">built by teams.</span>
              </h1>
              <p className="text-base text-[#8B8FA8] leading-relaxed max-w-md">
                Find the creators, editors, designers and writers your channel needs — or get discovered by the teams building tomorrow.
              </p>
              <div className="flex items-center gap-3 flex-wrap">
                <button className="flex items-center gap-2 px-6 py-3 bg-[#1769FF] text-white font-semibold rounded-xl hover:bg-[#1357D4] transition-colors shadow-lg shadow-[#1769FF]/25 text-sm">
                  Find Work <ArrowRight className="w-4 h-4" />
                </button>
                <button className="flex items-center gap-2 px-6 py-3 border border-white/[0.12] text-[#F0F2F5] font-semibold rounded-xl hover:border-[#1769FF]/50 hover:text-[#7EB3FF] transition-all text-sm" style={{ background: "#1C2028" }}>
                  Browse Talent <Users className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="flex flex-col gap-6 items-start md:items-end">
              <div className="rounded-2xl px-8 py-6 text-right border border-white/[0.07]" style={{ background: "#161A21" }}>
                <p className="text-5xl font-black tracking-tighter leading-none text-[#F0F2F5]">2-sided</p>
                <p className="text-xs font-semibold text-[#8B8FA8] mt-2 uppercase tracking-widest">Jobs and talent in one market</p>
              </div>
              <div className="grid grid-cols-2 gap-3 w-full max-w-xs">
                {stats.map((s) => (
                  <div key={s.label} className="rounded-xl px-4 py-3 border border-[#1769FF]/20" style={{ background: "rgba(23,105,255,0.08)" }}>
                    <p className="text-xl font-black text-[#1769FF]">{s.value}</p>
                    <p className="text-xs text-[#8B8FA8] mt-0.5">{s.label}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Search */}
          <div className="mt-10 flex gap-2 max-w-2xl">
            <div className="flex-1 relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8B8FA8]" />
              <input
                type="text"
                placeholder="Search for editing, design, writing..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-11 pr-4 py-3.5 text-sm rounded-xl border border-white/[0.07] focus:border-[#1769FF]/60 focus:outline-none transition-all placeholder-[#8B8FA8] text-[#F0F2F5]"
                style={{ background: "#1C2028" }}
              />
            </div>
            <button className="px-6 py-3.5 bg-[#1769FF] text-white font-semibold rounded-xl hover:bg-[#1357D4] transition-colors text-sm shadow-lg shadow-[#1769FF]/20">
              Search
            </button>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {categories.map((cat) => (
              <button key={cat} className="px-3.5 py-1.5 text-xs font-medium rounded-full border border-white/[0.08] text-[#8B8FA8] hover:border-[#1769FF]/40 hover:text-[#7EB3FF] transition-all" style={{ background: "#1C2028" }}>
                {cat}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* ── Social proof ticker ── */}
      <section className="py-3 overflow-hidden border-b border-white/[0.06]" style={{ background: "#1769FF" }}>
        <div className="flex items-center whitespace-nowrap">
          <div className="flex items-center gap-10 animate-[marquee_30s_linear_infinite]">
            {[...brandLogos, ...brandLogos].map((name, i) => (
              <span key={i} className="text-white/80 font-semibold text-sm flex items-center gap-3">
                <span className="w-1.5 h-1.5 rounded-full bg-white/40 flex-shrink-0" />{name}
              </span>
            ))}
          </div>
        </div>
        <style>{`@keyframes marquee { from { transform: translateX(0); } to { transform: translateX(-50%); } }`}</style>
      </section>

      {/* ── Why CreatorJobs ── */}
      <section className="border-b border-white/[0.07]" style={{ background: "#0D0F12" }}>
        <div className="max-w-7xl mx-auto px-6 py-14">
          <div className="text-center mb-10">
            <p className="text-xs font-bold text-[#1769FF] uppercase tracking-widest mb-2">Why CreatorJobs</p>
            <h2 className="text-2xl md:text-3xl font-bold text-[#F0F2F5]">Everything the creator economy needs</h2>
            <p className="text-sm text-[#8B8FA8] mt-2 max-w-md mx-auto">Purpose-built for YouTube, Shorts, and every format in between.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {whyUs.map(({ icon: Icon, title, description }) => (
              <div key={title} className="flex flex-col gap-3 p-5 rounded-2xl border border-white/[0.07] hover:border-[#1769FF]/30 hover:shadow-lg hover:shadow-[#1769FF]/10 transition-all" style={{ background: "#161A21" }}>
                <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "rgba(23,105,255,0.12)" }}>
                  <Icon className="w-5 h-5 text-[#1769FF]" />
                </div>
                <p className="font-bold text-sm text-[#F0F2F5]">{title}</p>
                <p className="text-xs text-[#8B8FA8] leading-relaxed">{description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── How it Works ── */}
      <section className="border-b border-white/[0.07]" style={{ background: "#161A21" }}>
        <div className="max-w-7xl mx-auto px-6 py-14">
          <div className="text-center mb-10">
            <p className="text-xs font-bold text-[#1769FF] uppercase tracking-widest mb-2">How it works</p>
            <h2 className="text-2xl md:text-3xl font-bold text-[#F0F2F5]">Get hired in three steps</h2>
          </div>
          <div className="flex justify-center mb-10">
            <div className="inline-flex rounded-xl p-1 gap-1 border border-white/[0.07]" style={{ background: "#0D0F12" }}>
              {(["talent", "creator"] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`px-5 py-2 rounded-lg text-sm font-semibold transition-all ${activeTab === tab ? "bg-[#1769FF] text-white shadow-md shadow-[#1769FF]/30" : "text-[#8B8FA8] hover:text-[#F0F2F5]"}`}
                >
                  {tab === "talent" ? "For Talent" : "For Creators"}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 relative">
            <div className="hidden md:block absolute top-8 left-[calc(16.67%+1rem)] right-[calc(16.67%+1rem)] h-px" style={{ background: "linear-gradient(to right, rgba(23,105,255,0.2), #1769FF, rgba(23,105,255,0.2))" }} />
            {howItWorks.map(({ step, icon: Icon, title, description }) => (
              <div key={step} className="relative flex flex-col items-center text-center gap-4 p-6 rounded-2xl border border-white/[0.07] hover:border-[#1769FF]/30 transition-all" style={{ background: "#0D0F12" }}>
                <div className="w-14 h-14 rounded-2xl bg-[#1769FF] flex items-center justify-center shadow-lg shadow-[#1769FF]/30 relative z-10">
                  <Icon className="w-6 h-6 text-white" />
                </div>
                <span className="text-xs font-black text-[#1769FF] tracking-widest">{step}</span>
                <p className="font-bold text-[#F0F2F5]">{title}</p>
                <p className="text-xs text-[#8B8FA8] leading-relaxed">{activeTab === "creator" ? description.replace("Sign up", "Post your job").replace("apply to jobs", "review applicants").replace("Get hired", "Hire & collaborate") : description}</p>
              </div>
            ))}
          </div>
          <div className="flex justify-center mt-8">
            <button className="flex items-center gap-2 px-8 py-3.5 bg-[#1769FF] text-white font-semibold rounded-xl hover:bg-[#1357D4] transition-colors shadow-lg shadow-[#1769FF]/25 text-sm">
              {activeTab === "talent" ? "Create your free profile" : "Post your first job"} <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </section>

      {/* ── Browse by Category ── */}
      <section className="border-b border-white/[0.07]" style={{ background: "#0D0F12" }}>
        <div className="max-w-7xl mx-auto px-6 py-14">
          <div className="flex items-end justify-between mb-8">
            <div>
              <p className="text-xs font-bold text-[#1769FF] uppercase tracking-widest mb-2">Explore</p>
              <h2 className="text-2xl font-bold text-[#F0F2F5]">Browse by category</h2>
            </div>
            <a href="#" className="text-sm font-semibold text-[#1769FF] hover:underline flex items-center gap-1">All categories <ArrowRight className="w-4 h-4" /></a>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
            {featuredCategories.map(({ icon: Icon, label, count, color, bg }) => (
              <button key={label} className="flex flex-col items-center gap-2.5 p-4 rounded-2xl border border-white/[0.07] hover:border-[#1769FF]/30 hover:shadow-lg hover:shadow-[#1769FF]/10 transition-all cursor-pointer" style={{ background: "#161A21" }}>
                <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: bg }}>
                  <Icon className="w-5 h-5" style={{ color }} />
                </div>
                <p className="text-xs font-bold text-[#F0F2F5] text-center leading-tight">{label}</p>
                <p className="text-xs text-[#8B8FA8]">{count}</p>
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* ── Recent Job Listings ── */}
      <section className="max-w-7xl mx-auto px-6 py-12">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-bold text-[#F0F2F5]">Recent Job Listings</h2>
            <p className="text-sm text-[#8B8FA8] mt-0.5">Fresh opportunities posted by top creators</p>
          </div>
          <a href="#" className="flex items-center gap-1 text-sm font-semibold text-[#1769FF] hover:underline">View more <ArrowRight className="w-4 h-4" /></a>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {jobListings.map((job) => <JobCard key={job.id} job={job} />)}
        </div>
      </section>

      <div className="max-w-7xl mx-auto px-6"><div className="border-t border-white/[0.06]" /></div>

      {/* ── Recent Talent Listings ── */}
      <section className="max-w-7xl mx-auto px-6 py-12">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-bold text-[#F0F2F5]">Recent Talent Listings</h2>
            <p className="text-sm text-[#8B8FA8] mt-0.5">Creators available for hire right now</p>
          </div>
          <a href="#" className="flex items-center gap-1 text-sm font-semibold text-[#1769FF] hover:underline">View more <ArrowRight className="w-4 h-4" /></a>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {talentListings.map((t) => <TalentCard key={t.id} talent={t} />)}
        </div>
      </section>

      {/* ── Testimonials ── */}
      <section className="border-t border-white/[0.07]" style={{ background: "#161A21" }}>
        <div className="max-w-7xl mx-auto px-6 py-14">
          <div className="text-center mb-10">
            <p className="text-xs font-bold text-[#1769FF] uppercase tracking-widest mb-2">Reviews</p>
            <h2 className="text-2xl md:text-3xl font-bold text-[#F0F2F5]">Loved by creators and talent alike</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {testimonials.map((t) => (
              <div key={t.name} className="flex flex-col gap-4 p-6 rounded-2xl border border-white/[0.07] hover:border-[#1769FF]/25 transition-all" style={{ background: "#0D0F12" }}>
                <Quote className="w-6 h-6 text-[#1769FF]/30" fill="currentColor" />
                <p className="text-sm text-[#8B8FA8] leading-relaxed flex-1">"{t.text}"</p>
                <div className="flex items-center gap-3 pt-3 border-t border-white/[0.06]">
                  <Av initials={t.avatar} color={t.color} size="sm" />
                  <div>
                    <p className="text-sm font-bold text-[#F0F2F5]">{t.name}</p>
                    <p className="text-xs text-[#8B8FA8]">{t.role}</p>
                  </div>
                  <span className="ml-auto text-xs font-semibold text-[#7EB3FF] px-2 py-0.5 rounded-full border border-[#1769FF]/25" style={{ background: "rgba(23,105,255,0.12)" }}>{t.hires}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── NEW: Platform comparison ── */}
      <section className="border-t border-white/[0.07]" style={{ background: "#0D0F12" }}>
        <div className="max-w-4xl mx-auto px-6 py-14">
          <div className="text-center mb-10">
            <p className="text-xs font-bold text-[#1769FF] uppercase tracking-widest mb-2">Comparison</p>
            <h2 className="text-2xl font-bold text-[#F0F2F5]">Why not just use Fiverr?</h2>
            <p className="text-sm text-[#8B8FA8] mt-2 max-w-md mx-auto">We built what Fiverr and Upwork never could — a platform that speaks creator.</p>
          </div>
          <div className="rounded-2xl border border-white/[0.07] overflow-hidden" style={{ background: "#161A21" }}>
            <div className="grid grid-cols-4 text-xs font-bold uppercase tracking-widest border-b border-white/[0.07]">
              <div className="px-5 py-4 text-[#8B8FA8]">Feature</div>
              <div className="px-5 py-4 text-center text-[#7EB3FF]" style={{ background: "rgba(23,105,255,0.08)" }}>CreatorJobs</div>
              <div className="px-5 py-4 text-center text-[#8B8FA8]">Fiverr</div>
              <div className="px-5 py-4 text-center text-[#8B8FA8]">Upwork</div>
            </div>
            {comparisons.map(({ feature, us, fiverr, upwork }, i) => (
              <div key={feature} className={`grid grid-cols-4 text-sm border-b border-white/[0.05] last:border-0 ${i % 2 === 0 ? "" : ""}`}>
                <div className="px-5 py-3.5 text-[#8B8FA8]">{feature}</div>
                <div className="px-5 py-3.5 text-center font-bold" style={{ background: "rgba(23,105,255,0.06)" }}>
                  {us ? <span className="text-green-400">✓</span> : <span className="text-[#8B8FA8]/40">—</span>}
                </div>
                <div className="px-5 py-3.5 text-center">
                  {fiverr ? <span className="text-green-400">✓</span> : <span className="text-[#8B8FA8]/40">—</span>}
                </div>
                <div className="px-5 py-3.5 text-center">
                  {upwork ? <span className="text-green-400">✓</span> : <span className="text-[#8B8FA8]/40">—</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── NEW: Job alert email signup ── */}
      <section className="border-t border-white/[0.07]" style={{ background: "#161A21" }}>
        <div className="max-w-2xl mx-auto px-6 py-14 text-center flex flex-col items-center gap-5">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ background: "rgba(23,105,255,0.12)" }}>
            <Mail className="w-6 h-6 text-[#1769FF]" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-[#F0F2F5]">Get job alerts in your inbox</h2>
            <p className="text-sm text-[#8B8FA8] mt-1">New jobs matching your skills, delivered daily. No spam.</p>
          </div>
          <div className="flex gap-2 w-full max-w-sm">
            <input
              type="email"
              placeholder="your@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="flex-1 px-4 py-3 text-sm rounded-xl border border-white/[0.07] focus:border-[#1769FF]/60 focus:outline-none transition-all placeholder-[#8B8FA8] text-[#F0F2F5]"
              style={{ background: "#0D0F12" }}
            />
            <button className="px-5 py-3 bg-[#1769FF] text-white text-sm font-semibold rounded-xl hover:bg-[#1357D4] transition-colors shadow-md shadow-[#1769FF]/25">
              Subscribe
            </button>
          </div>
          <p className="text-xs text-[#8B8FA8]/60">Join 4,200+ creators already subscribed.</p>
        </div>
      </section>

      {/* ── NEW: FAQ ── */}
      <section className="border-t border-white/[0.07]" style={{ background: "#0D0F12" }}>
        <div className="max-w-3xl mx-auto px-6 py-14">
          <div className="text-center mb-10">
            <p className="text-xs font-bold text-[#1769FF] uppercase tracking-widest mb-2">FAQ</p>
            <h2 className="text-2xl font-bold text-[#F0F2F5]">Questions we get a lot</h2>
          </div>
          <div className="flex flex-col gap-3">
            {faqs.map((f) => <FaqItem key={f.q} q={f.q} a={f.a} />)}
          </div>
        </div>
      </section>

      {/* ── Dual CTA split ── */}
      <section className="border-t border-white/[0.07]" style={{ background: "#161A21" }}>
        <div className="max-w-7xl mx-auto px-6 py-12">
          <div className="grid md:grid-cols-2 gap-5">
            <div className="bg-[#1769FF] rounded-2xl p-8 flex flex-col gap-4">
              <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center"><Briefcase className="w-5 h-5 text-white" /></div>
              <h3 className="text-xl font-bold text-white">Looking for work?</h3>
              <p className="text-sm text-white/70 leading-relaxed">Join 1,800+ verified creators earning from their skills. Set your own rates, work remotely.</p>
              <button className="mt-2 self-start flex items-center gap-2 px-5 py-2.5 bg-white text-[#1769FF] text-sm font-bold rounded-xl hover:bg-blue-50 transition-colors">
                Create talent profile <ArrowRight className="w-4 h-4" />
              </button>
            </div>
            <div className="rounded-2xl p-8 flex flex-col gap-4 border border-white/[0.07]" style={{ background: "#0D0F12" }}>
              <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "rgba(255,255,255,0.05)" }}><Users className="w-5 h-5 text-[#F0F2F5]" /></div>
              <h3 className="text-xl font-bold text-[#F0F2F5]">Building a team?</h3>
              <p className="text-sm text-[#8B8FA8] leading-relaxed">Post a job and get applications from YouTube-native talent within hours, not weeks.</p>
              <button className="mt-2 self-start flex items-center gap-2 px-5 py-2.5 bg-[#1769FF] text-white text-sm font-bold rounded-xl hover:bg-[#1357D4] transition-colors shadow-md shadow-[#1769FF]/30">
                Post a job free <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* ── Footer CTA ── */}
      <section className="border-t border-white/[0.07]" style={{ background: "#0D0F12" }}>
        <div className="max-w-7xl mx-auto px-6 py-16 md:py-20 text-center flex flex-col items-center gap-6">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-white/[0.08]" style={{ background: "rgba(255,255,255,0.05)" }}>
            <span className="w-1.5 h-1.5 rounded-full bg-[#1769FF]" />
            <span className="text-xs font-semibold text-[#8B8FA8]">The creator economy's hiring platform</span>
          </div>
          <h2 className="text-3xl md:text-4xl font-bold text-[#F0F2F5] leading-tight max-w-lg">Build your creator team.</h2>
          <p className="text-[#8B8FA8] text-base max-w-md leading-relaxed">Find the right talent to grow your channel — or get discovered by ambitious creator teams.</p>
          <div className="flex items-center gap-3 flex-wrap justify-center">
            <button className="px-6 py-3 bg-[#1769FF] text-white font-semibold rounded-xl hover:bg-[#1357D4] transition-colors text-sm shadow-lg shadow-[#1769FF]/30">Start hiring today</button>
            <button className="px-6 py-3 border border-white/[0.12] text-[#F0F2F5] font-semibold rounded-xl hover:border-white/25 transition-all text-sm">Join as talent</button>
          </div>
          <p className="text-xs text-[#8B8FA8]/50 mt-4">© 2025 CreatorJobs · Built for the creator economy</p>
        </div>
      </section>

    </div>
  );
}
