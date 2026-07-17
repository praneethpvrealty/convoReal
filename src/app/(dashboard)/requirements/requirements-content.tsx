"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { toast } from "sonner"
import {
  ClipboardList,
  Search,
  Copy,
  Check,
  Share2,
  MessageSquare,
  Sparkles,
  Users,
  AlertTriangle,
  Building,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { AnimatedCounter } from "@/components/ui/animated-counter"
import { Input } from "@/components/ui/input"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { ChecklistLoader } from "@/components/ui/checklist-loader"
import { ConvoRealLoader } from "@/components/ui/convoreal-loader"
import { NameTagBadge } from "@/components/contacts/name-tag-badge"

interface Tag {
  id: string
  name: string
  color?: string
}

interface ContactNote {
  id: string
  note_text: string
  created_at: string
}

interface ContactTagJoin {
  id: string
  tag_id: string
  tags: Tag | null
}

interface ConversationJoin {
  id: string
}

interface ConsolidatedContact {
  id: string
  name: string
  phone: string
  email?: string
  name_tag?: string | null
  classification: "Buyer" | "Agent"
  lead_temp?: "HOT" | "COLD" | "Not Responding" | "Dead" | null
  min_budget?: number
  max_budget?: number
  no_budget?: boolean
  requirements?: string
  areas_of_interest?: string[]
  property_interests?: string[]
  contact_notes?: ContactNote[]
  contact_tags?: ContactTagJoin[]
  conversations?: ConversationJoin[]
  created_at: string
}

export default function RequirementsPage() {
  const router = useRouter()
  const { accountId, user } = useAuth()
  const [data, setData] = useState<ConsolidatedContact[]>([])
  const [loading, setLoading] = useState(true)

  // Filters state
  const [search, setSearch] = useState("")
  const [classificationFilter, setClassificationFilter] = useState("All")
  const [priorityFilter, setPriorityFilter] = useState("All")

  // Copy status per card
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const fetchRequirements = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch("/api/requirements")
      if (!response.ok) throw new Error("Failed to fetch requirements")
      const result = await response.json()
      setData(result || [])
    } catch (err) {
      console.error("[Requirements] Fetch error:", err)
      toast.error("Failed to load consolidated requirements")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (accountId) {
      fetchRequirements()
    }
  }, [accountId, fetchRequirements])

  // Stats calculation
  const stats = useMemo(() => {
    const total = data.length
    const hot = data.filter((c) => c.lead_temp === "HOT").length
    const buyers = data.filter((c) => c.classification === "Buyer").length
    const agents = data.filter((c) => c.classification === "Agent").length

    return { total, hot, buyers, agents }
  }, [data])

  // Text formatter for copy/share operations
  const formatRequirementText = (c: ConsolidatedContact) => {
    const budgetStr = c.no_budget
      ? "No Budget Limit"
      : c.max_budget
      ? `Budget: ${formatCurrency(c.max_budget)}`
      : "Budget: Not specified"

    const reqs = c.requirements ? `Requirements: ${c.requirements}` : ""
    const areas =
      c.areas_of_interest && c.areas_of_interest.length > 0
        ? `Locations: ${c.areas_of_interest.join(", ")}`
        : ""
    const tagsStr =
      c.contact_tags && c.contact_tags.length > 0
        ? `Tags: ${c.contact_tags.map((t) => t.tags?.name).filter(Boolean).join(", ")}`
        : ""

    const recentNotes =
      c.contact_notes && c.contact_notes.length > 0
        ? `Notes: ${c.contact_notes[0].note_text}`
        : ""

    return [
      `Client Profile: ${c.name} (${c.classification})`,
      budgetStr,
      reqs,
      areas,
      tagsStr,
      recentNotes,
    ]
      .filter(Boolean)
      .join("\n• ")
  }

  const handleCopy = async (c: ConsolidatedContact) => {
    const text = formatRequirementText(c)
    await navigator.clipboard.writeText(text)
    setCopiedId(c.id)
    toast.success("Requirements copied to clipboard")
    setTimeout(() => setCopiedId(null), 2500)
  }

  const handleShareWhatsApp = (c: ConsolidatedContact) => {
    const text = `*CONSOLIDATED CLIENT REQUIREMENT*\n\n• ` + formatRequirementText(c)
    const url = `https://wa.me/?text=${encodeURIComponent(text)}`
    window.open(url, "_blank")
  }

  const handleStartChat = async (c: ConsolidatedContact) => {
    if (!accountId) return
    const existingId = c.conversations?.[0]?.id

    if (existingId) {
      router.push(`/inbox?c=${existingId}`)
      return
    }

    // Create a new conversation if none exists
    try {
      const supabase = createClient()
      const { data: newConv, error } = await supabase
        .from("conversations")
        .insert({
          account_id: accountId,
          user_id: user?.id,
          contact_id: c.id,
        })
        .select("id")
        .single()

      if (error) throw error
      if (newConv) {
        router.push(`/inbox?c=${newConv.id}`)
      }
    } catch (err) {
      console.error("Failed to create conversation:", err)
      toast.error("Failed to start chat thread")
    }
  }

  const formatCurrency = (val: number) => {
    if (val >= 10000000) return `₹${(val / 10000000).toFixed(2).replace(/\.00$/, "")} Cr`
    if (val >= 100000) return `₹${(val / 100000).toFixed(2).replace(/\.00$/, "")} L`
    return `₹${val.toLocaleString("en-IN")}`
  }

  // Filtered Cards list
  const filteredData = useMemo(() => {
    return data.filter((c) => {
      // Search text match
      const nameMatch = c.name?.toLowerCase().includes(search.toLowerCase())
      const phoneMatch = c.phone?.includes(search)
      const reqMatch = c.requirements?.toLowerCase().includes(search.toLowerCase())
      const notesMatch = c.contact_notes?.some((n) =>
        n.note_text.toLowerCase().includes(search.toLowerCase())
      )
      const searchMatch = nameMatch || phoneMatch || reqMatch || notesMatch

      // Classification match
      const classMatch =
        classificationFilter === "All" || c.classification === classificationFilter

      // Priority match
      const priorityMatch =
        priorityFilter === "All" ||
        (priorityFilter === "High" && c.lead_temp === "HOT") ||
        (priorityFilter === "Medium" && c.lead_temp !== "HOT" && c.lead_temp !== "Dead" && c.lead_temp) ||
        (priorityFilter === "Low" && (!c.lead_temp || c.lead_temp === "Dead"))

      return searchMatch && classMatch && priorityMatch
    })
  }, [data, search, classificationFilter, priorityFilter])

  return (
    <div className="flex flex-col flex-1 p-6 space-y-6 relative overflow-hidden">
      {/* Background ambient glows */}
      <div className="absolute -top-40 -right-40 w-[500px] h-[500px] bg-primary/12 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute top-1/2 -left-40 w-[450px] h-[450px] bg-indigo-500/8 rounded-full blur-[110px] pointer-events-none" />

      {/* Header */}
      <div className="relative z-10 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-white tracking-tight flex items-center gap-2.5">
            <ClipboardList className="size-8 text-primary animate-pulse" />
            Requirements Consolidation
          </h1>
          <p className="text-slate-400 text-sm mt-1 font-medium">
            Assimilation of client property preferences, priorities, and budgets parsed from conversations.
          </p>
        </div>
      </div>

      {/* Stats Board */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 relative z-10">
        <button
          type="button"
          onClick={() => {
            setClassificationFilter("All");
            setPriorityFilter("All");
          }}
          className={`rounded-2xl border p-5 backdrop-blur-sm shadow transition-all duration-300 cursor-pointer text-left focus:outline-none ${
            classificationFilter === "All" && priorityFilter === "All"
              ? "border-primary bg-slate-900/70 shadow shadow-primary/10 ring-1 ring-primary/25"
              : "border-slate-800/80 bg-slate-900/45 hover:border-primary/25 hover:bg-slate-900/60"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400 font-bold uppercase tracking-wider">Total Demands</span>
            <Sparkles className="size-4 text-primary" />
          </div>
          <div className="mt-2.5 text-2xl font-black text-white">
            <AnimatedCounter value={stats.total} />
          </div>
        </button>

        <button
          type="button"
          onClick={() => {
            setClassificationFilter("All");
            setPriorityFilter("High");
          }}
          className={`rounded-2xl border p-5 backdrop-blur-sm shadow transition-all duration-300 cursor-pointer text-left focus:outline-none ${
            priorityFilter === "High"
              ? "border-rose-500 bg-rose-950/10 shadow shadow-rose-500/10 ring-1 ring-rose-500/25"
              : "border-slate-800/80 bg-slate-900/45 hover:border-rose-500/30 hover:bg-slate-900/60"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400 font-bold uppercase tracking-wider">High Priority</span>
            <span className="h-2 w-2 rounded-full bg-rose-500 animate-ping" />
          </div>
          <div className="mt-2.5 text-2xl font-black text-rose-400">
            <AnimatedCounter value={stats.hot} />
          </div>
        </button>

        <button
          type="button"
          onClick={() => {
            setClassificationFilter("Buyer");
            setPriorityFilter("All");
          }}
          className={`rounded-2xl border p-5 backdrop-blur-sm shadow transition-all duration-300 cursor-pointer text-left focus:outline-none ${
            classificationFilter === "Buyer"
              ? "border-emerald-500 bg-emerald-950/10 shadow shadow-emerald-500/10 ring-1 ring-emerald-500/25"
              : "border-slate-800/80 bg-slate-900/45 hover:border-emerald-500/30 hover:bg-slate-900/60"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400 font-bold uppercase tracking-wider">Buyer Demands</span>
            <Users className="size-4 text-emerald-400" />
          </div>
          <div className="mt-2.5 text-2xl font-black text-white">
            <AnimatedCounter value={stats.buyers} />
          </div>
        </button>

        <button
          type="button"
          onClick={() => {
            setClassificationFilter("Agent");
            setPriorityFilter("All");
          }}
          className={`rounded-2xl border p-5 backdrop-blur-sm shadow transition-all duration-300 cursor-pointer text-left focus:outline-none ${
            classificationFilter === "Agent"
              ? "border-sky-500 bg-sky-950/10 shadow shadow-sky-500/10 ring-1 ring-sky-500/25"
              : "border-slate-800/80 bg-slate-900/45 hover:border-sky-500/30 hover:bg-slate-900/60"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400 font-bold uppercase tracking-wider">Agent Demands</span>
            <Building className="size-4 text-sky-400" />
          </div>
          <div className="mt-2.5 text-2xl font-black text-white">
            <AnimatedCounter value={stats.agents} />
          </div>
        </button>
      </div>

      {/* Filter toolbar */}
      <div className="flex flex-col lg:flex-row gap-4 bg-slate-900/60 border border-slate-800/80 rounded-2xl p-4.5 relative z-10">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-slate-500" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by client, phone, requirements or notes..."
            className="pl-9.5 bg-slate-950/40 border-slate-850 text-white placeholder:text-slate-550 h-9.5 rounded-xl focus:border-primary/50"
          />
        </div>

        <div className="flex flex-wrap gap-3 shrink-0">
          <select
            value={classificationFilter}
            onChange={(e) => setClassificationFilter(e.target.value)}
            className="h-9.5 rounded-xl border border-slate-850 bg-slate-950/40 px-3 text-xs text-slate-300 focus:outline-none focus:ring-1 focus:ring-primary/20 cursor-pointer font-bold"
          >
            <option value="All">All Types</option>
            <option value="Buyer">Buyers Only</option>
            <option value="Agent">Agents Only</option>
          </select>

          <select
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value)}
            className="h-9.5 rounded-xl border border-slate-850 bg-slate-950/40 px-3 text-xs text-slate-300 focus:outline-none focus:ring-1 focus:ring-primary/20 cursor-pointer font-bold"
          >
            <option value="All">All Priorities</option>
            <option value="High">🔥 High Priority (HOT)</option>
            <option value="Medium">⏳ Medium Priority</option>
            <option value="Low">💤 Low Priority</option>
          </select>
        </div>
      </div>

      {/* Cards Grid */}
      <div className="relative z-10 flex-1 min-h-0">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 text-slate-400">
            <ChecklistLoader size={104} label="Assembling client requirements" className="mb-3" />
            <ConvoRealLoader size={20} className="mb-2" />
            <p className="text-sm">Assembling client requirements...</p>
          </div>
        ) : filteredData.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 border border-slate-800/80 bg-slate-900/25 rounded-2xl">
            <AlertTriangle className="size-10 text-slate-655" />
            <h3 className="mt-4 text-sm font-semibold text-slate-300">No Requirements Found</h3>
            <p className="mt-1 text-xs text-slate-500 font-medium">Try broadening your search or selection filters.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredData.map((c) => {
              const isHot = c.lead_temp === "HOT"
              return (
                <div
                  key={c.id}
                  className={`flex flex-col rounded-2xl border p-5 backdrop-blur-sm shadow transition-all duration-300 relative group overflow-hidden ${
                    isHot
                      ? "border-primary bg-slate-900/65 shadow-primary/10 ring-1 ring-primary/25"
                      : "border-slate-800/80 bg-slate-900/45 hover:border-primary/25 hover:shadow-primary/5 hover:scale-[1.01]"
                  }`}
                >
                  {/* Subtle top accent corner glow */}
                  <div className="absolute top-0 right-0 w-24 h-24 bg-primary/5 rounded-full blur-[24px] pointer-events-none group-hover:bg-primary/10 transition-all" />

                  {/* Header Row */}
                  <div className="flex items-start justify-between gap-2.5">
                    <div className="flex items-center gap-3">
                      <Avatar className="size-9 border border-slate-800">
                        <AvatarFallback className="bg-primary/10 text-xs font-black text-primary">
                          {c.name?.charAt(0).toUpperCase() || "?"}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <h3 className="text-sm font-black text-white group-hover:text-primary transition-colors flex items-center gap-1.5">
                          <span>{c.name}</span>
                          <NameTagBadge tag={c.name_tag} />
                        </h3>
                        <p className="text-[10px] text-slate-500 mt-0.5">{c.phone}</p>
                      </div>
                    </div>

                    <div className="flex flex-col items-end gap-1.5 shrink-0">
                      <span
                        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[9px] font-bold ${
                          c.classification === "Buyer"
                            ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                            : "bg-sky-500/10 text-sky-400 border-sky-500/20"
                        }`}
                      >
                        {c.classification}
                      </span>
                      {c.lead_temp && (
                        <span
                          className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[8px] font-black ${
                            isHot
                              ? "bg-rose-500/15 text-rose-400 border-rose-500/25"
                              : c.lead_temp === "COLD"
                              ? "bg-sky-500/10 text-sky-400 border-sky-500/20"
                              : "bg-slate-800 text-slate-400 border-slate-700"
                          }`}
                        >
                          {isHot && "🔥 "}
                          {c.lead_temp}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Requirements Section */}
                  <div className="mt-5 flex-1 space-y-3.5">
                    {/* Budget row */}
                    <div className="flex items-center justify-between text-xs border-b border-slate-900/60 pb-2">
                      <span className="font-bold text-slate-450">Estimated Budget</span>
                      <span className="font-black text-white">
                        {c.no_budget
                          ? "No limit"
                          : c.max_budget
                          ? formatCurrency(c.max_budget)
                          : "Not specified"}
                      </span>
                    </div>

                    {/* Requirements Text */}
                    {c.requirements && (
                      <div className="space-y-1">
                        <span className="text-[10px] font-black text-slate-550 uppercase tracking-widest block">
                          Demands Statement
                        </span>
                        <p className="text-xs text-slate-300 font-medium leading-relaxed bg-slate-950/20 border border-slate-900 p-2.5 rounded-xl">
                          {c.requirements}
                        </p>
                      </div>
                    )}

                    {/* Tags */}
                    {c.contact_tags && c.contact_tags.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {c.contact_tags.map((ct) => (
                          <span
                            key={ct.id}
                            className="inline-flex items-center rounded-lg bg-slate-950/40 border border-slate-900 px-2 py-0.5 text-[9px] font-bold text-slate-400"
                          >
                            {ct.tags?.name}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Assimilated Notes Extract */}
                    {c.contact_notes && c.contact_notes.length > 0 && (
                      <div className="space-y-1.5 pt-1">
                        <span className="text-[10px] font-black text-slate-550 uppercase tracking-widest block flex items-center gap-1.5">
                          <Sparkles className="size-3 text-primary animate-pulse" />
                          Assimilated Note
                        </span>
                        <p className="text-[11px] text-slate-400 italic font-medium leading-relaxed bg-primary/3 border border-primary/10 p-2.5 rounded-xl">
                          &quot;{c.contact_notes[0].note_text}&quot;
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Actions Drawer */}
                  <div className="mt-6 border-t border-slate-900/60 pt-4 flex items-center justify-between gap-2.5">
                    {/* Inbox redirection */}
                    <Button
                      onClick={() => handleStartChat(c)}
                      variant="ghost"
                      size="sm"
                      className="text-xs font-bold text-slate-400 hover:text-white flex items-center gap-1.5 hover:bg-slate-900/30 p-2 h-8 rounded-xl cursor-pointer"
                    >
                      <MessageSquare className="size-3.5 text-primary" />
                      Chat Thread
                    </Button>

                    <div className="flex items-center gap-2">
                      {/* Copy Action */}
                      <Button
                        onClick={() => handleCopy(c)}
                        variant="ghost"
                        size="icon-sm"
                        className="text-slate-400 hover:text-white hover:bg-slate-900/30 h-8 w-8 rounded-xl cursor-pointer flex items-center justify-center shrink-0 border border-slate-900 bg-slate-950/20"
                        title="Copy to clipboard"
                      >
                        {copiedId === c.id ? (
                          <Check className="size-3.5 text-emerald-400" />
                        ) : (
                          <Copy className="size-3.5" />
                        )}
                      </Button>

                      {/* WhatsApp Share Action */}
                      <Button
                        onClick={() => handleShareWhatsApp(c)}
                        variant="ghost"
                        size="icon-sm"
                        className="text-slate-400 hover:text-white hover:bg-slate-900/30 h-8 w-8 rounded-xl cursor-pointer flex items-center justify-center shrink-0 border border-slate-900 bg-slate-950/20"
                        title="Share on WhatsApp"
                      >
                        <Share2 className="size-3.5 text-primary" />
                      </Button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
