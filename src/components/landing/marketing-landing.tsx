'use client';

import { useRouter } from 'next/navigation';
import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import {
  MessageSquare,
  Bot,
  Zap,
  Users,
  Layers,
  ArrowRight,
  Check,
  Sparkles,
  Globe,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Play,
  Building,
  Send,
  Bell,
  ShoppingCart,
  Landmark,
  Handshake,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConvoRealMark } from '@/components/brand/mark';
import { MARKETING_CONFIG } from '@/config/marketing';
import { EngineLeadForm } from '@/components/landing/engine-lead-form';
import { EngineLeadBot } from '@/components/landing/engine-lead-bot';
import { BRANDING } from '@/config/branding';
import { PUBLIC_TOOLS, TOOLS_PATH } from '@/lib/marketing/public-tools';
import { ToolIcon } from '@/components/landing/tool-icon';

export function MarketingLanding() {
  const router = useRouter();
  // Catch recovery/reset password, session tokens, or auth errors in URL hash and redirect client-side
  useEffect(() => {
    if (typeof window !== 'undefined' && window.location.hash) {
      const hash = window.location.hash;
      if (hash.includes('access_token=')) {
        if (
          hash.includes('type=recovery') ||
          window.location.href.includes('recovery')
        ) {
          window.location.replace(`/reset-password${hash}`);
        } else {
          window.location.replace(`/dashboard${hash}`);
        }
      } else if (hash.includes('error=')) {
        const params = new URLSearchParams(hash.substring(1)); // strip leading '#'
        const errorDesc =
          params.get('error_description') || 'Authentication failed';
        window.location.replace(
          `/login?error=${encodeURIComponent(errorDesc)}`
        );
      }
    }
  }, []);

  // Demo states
  const [demoStep, setDemoStep] = useState<'idle' | 'parsing' | 'completed'>(
    'idle'
  );
  const [copyStep, setCopyStep] = useState<'idle' | 'writing' | 'completed'>(
    'idle'
  );
  const [matchStep, setMatchStep] = useState<'idle' | 'matching' | 'completed'>(
    'idle'
  );
  const [showcaseStep, setShowcaseStep] = useState<
    'idle' | 'loading' | 'completed'
  >('idle');
  const [faqOpen, setFaqOpen] = useState<Record<number, boolean>>({});
  const [showLeadForm, setShowLeadForm] = useState(false);

  const handleSimulateParse = () => {
    if (demoStep !== 'idle') return;
    setDemoStep('parsing');
    setTimeout(() => {
      setDemoStep('completed');
    }, 1200);
  };

  const handleSimulateCopy = () => {
    if (copyStep !== 'idle') return;
    setCopyStep('writing');
    setTimeout(() => {
      setCopyStep('completed');
    }, 1200);
  };

  const handleSimulateMatch = () => {
    if (matchStep !== 'idle') return;
    setMatchStep('matching');
    setTimeout(() => {
      setMatchStep('completed');
    }, 1200);
  };

  const handleSimulateShowcase = () => {
    if (showcaseStep !== 'idle') return;
    setShowcaseStep('loading');
    setTimeout(() => {
      setShowcaseStep('completed');
    }, 1200);
  };

  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const scroll = (direction: 'left' | 'right') => {
    if (scrollContainerRef.current) {
      const { scrollLeft, clientWidth } = scrollContainerRef.current;
      const scrollAmount = clientWidth * 0.85; // Scroll 85% of screen width
      scrollContainerRef.current.scrollTo({
        left:
          direction === 'left'
            ? scrollLeft - scrollAmount
            : scrollLeft + scrollAmount,
        behavior: 'smooth',
      });
    }
  };

  const toggleFaq = (idx: number) => {
    setFaqOpen((prev) => ({
      ...prev,
      [idx]: !prev[idx],
    }));
  };

  // Helper to render correct icon dynamically
  const renderIcon = (iconName: string) => {
    switch (iconName) {
      case 'message':
        return <MessageSquare className="size-5" />;
      case 'bot':
        return <Bot className="size-5" />;
      case 'zap':
        return <Zap className="size-5" />;
      case 'globe':
        return <Globe className="size-5" />;
      case 'send':
        return <Send className="size-5" />;
      case 'bell':
        return <Bell className="size-5" />;
      case 'landmark':
        return <Landmark className="size-5" />;
      case 'handshake':
        return <Handshake className="size-5" />;
      default:
        return <Sparkles className="size-5" />;
    }
  };

  const isRealEstate = MARKETING_CONFIG.vertical === 'real_estate';

  return (
    <div className="relative flex min-h-screen flex-col overflow-x-hidden bg-slate-950 font-sans text-slate-100 selection:bg-indigo-500 selection:text-white">
      {/* Decorative Radial Background Lights */}
      <div className="pointer-events-none absolute top-0 left-1/4 h-[600px] w-[600px] rounded-full bg-indigo-500/10 blur-[140px]" />
      <div className="pointer-events-none absolute top-1/3 right-1/4 h-[500px] w-[500px] rounded-full bg-violet-500/5 blur-[120px]" />
      <div className="pointer-events-none absolute top-2/3 left-1/3 h-[600px] w-[600px] rounded-full bg-emerald-500/5 blur-[140px]" />

      {/* Header */}
      <header className="sticky top-0 z-50 w-full border-b border-slate-900 bg-slate-950/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-500 shadow-lg shadow-indigo-500/25">
              <ConvoRealMark className="h-6 w-6" />
            </div>
            <span className="bg-gradient-to-r from-white via-slate-200 to-indigo-400 bg-clip-text text-xl font-bold tracking-tight text-transparent">
              ConvoReal
            </span>
          </div>

          <nav className="hidden items-center gap-8 text-sm font-semibold text-slate-300 md:flex">
            <a href="#features" className="transition-colors hover:text-white">
              Features
            </a>
            <a href="#demo" className="transition-colors hover:text-white">
              Interactive Demo
            </a>
            {isRealEstate && (
              <Link
                href={TOOLS_PATH}
                className="transition-colors hover:text-white"
              >
                Free Tools
              </Link>
            )}
            <a href="#pricing" className="transition-colors hover:text-white">
              Pricing
            </a>
            <a href="#faq" className="transition-colors hover:text-white">
              FAQ
            </a>
            <a
              href="#get-started"
              className="transition-colors hover:text-white"
            >
              Talk to us
            </a>
          </nav>

          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              onClick={() => router.push('/login')}
              className="cursor-pointer px-4 text-xs font-semibold text-slate-300 hover:bg-slate-900/60 hover:text-white"
            >
              Sign In
            </Button>
            <Button
              onClick={() => router.push('/signup')}
              className="cursor-pointer rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white shadow-lg shadow-indigo-600/20 transition-all hover:scale-[1.02] hover:bg-indigo-500 hover:shadow-indigo-600/30"
            >
              Start Free Trial
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1">
        {/* Hero Section */}
        <section className="relative pt-20 pb-16 md:pt-32 md:pb-24">
          <div className="relative z-10 mx-auto max-w-7xl px-4 text-center sm:px-6 lg:px-8">
            {/* Tagline Badge */}
            <div className="animate-fade-in mb-6 inline-flex items-center gap-2 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-3 py-1.5 text-xs font-bold tracking-wide text-indigo-300">
              <Sparkles className="size-3.5" />
              {MARKETING_CONFIG.hero.badge}
            </div>

            {/* Main Headline */}
            <h1 className="mx-auto mb-6 max-w-4xl text-4xl leading-none font-black tracking-tight text-white sm:text-6xl">
              {MARKETING_CONFIG.hero.headlineStart}
              <span className="bg-gradient-to-r from-indigo-400 via-violet-400 to-emerald-400 bg-clip-text text-transparent">
                {MARKETING_CONFIG.hero.headlineHighlight}
              </span>
              {MARKETING_CONFIG.hero.headlineEnd}
            </h1>

            {/* Sub-headline */}
            <p className="mx-auto mb-10 max-w-2xl text-base leading-relaxed font-medium text-slate-400 sm:text-lg">
              {MARKETING_CONFIG.hero.subheadline}
            </p>

            {/* CTAs */}
            <div className="mb-20 flex flex-col items-center justify-center gap-4 sm:flex-row">
              <Button
                onClick={() => router.push('/signup')}
                className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-8 py-6 text-sm font-bold text-white shadow-xl shadow-indigo-600/25 transition-all hover:scale-103 hover:from-indigo-500 hover:to-violet-500 sm:w-auto"
              >
                {MARKETING_CONFIG.hero.ctaPrimary}
                <ArrowRight className="size-4" />
              </Button>
              <a
                href="#demo"
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-slate-800 bg-slate-900/40 px-8 py-3.5 text-sm font-semibold text-slate-200 transition-all hover:scale-102 hover:bg-slate-800 hover:text-white sm:w-auto"
              >
                <Play className="size-4 text-indigo-400" />
                {MARKETING_CONFIG.hero.ctaSecondary}
              </a>
            </div>

            {/* Dashboard Mockup */}
            <div className="group relative mx-auto max-w-5xl rounded-2xl border border-slate-800/80 bg-slate-900/30 p-2 shadow-2xl shadow-slate-950/80 backdrop-blur-md sm:p-4">
              <div className="absolute -inset-0.5 rounded-2xl bg-gradient-to-r from-indigo-500 to-violet-500 opacity-10 blur-xl transition-opacity group-hover:opacity-15" />
              <div className="relative flex aspect-[16/9] flex-col overflow-hidden rounded-xl border border-slate-950 bg-slate-950">
                {/* Header Mockup */}
                <div className="flex h-10 shrink-0 items-center justify-between border-b border-slate-800/50 bg-slate-900/80 px-4">
                  <div className="flex items-center gap-1.5">
                    <div className="size-3 rounded-full bg-rose-500/80" />
                    <div className="size-3 rounded-full bg-amber-500/80" />
                    <div className="size-3 rounded-full bg-emerald-500/80" />
                  </div>
                  <span className="font-mono text-[10px] tracking-widest text-slate-500">
                    https://app.convoreal.com/dashboard
                  </span>
                  <div className="w-12" />
                </div>
                {/* Dashboard layout simulator */}
                <div className="flex flex-1 overflow-hidden text-left text-xs text-slate-400">
                  {/* Left Sidebar */}
                  <div className="flex hidden w-36 shrink-0 flex-col gap-1.5 border-r border-slate-900/50 bg-slate-950 p-2 sm:flex">
                    <div className="flex h-5 items-center gap-1.5 rounded bg-indigo-500/10 px-2 py-0.5 font-bold text-indigo-300">
                      <MessageSquare className="size-3" /> Inbox
                    </div>
                    <div className="flex h-5 items-center gap-1.5 rounded px-2 py-0.5 hover:bg-slate-900">
                      <Users className="size-3" />{' '}
                      {isRealEstate ? 'Contacts' : 'Customers'}
                    </div>
                    <div className="flex h-5 items-center gap-1.5 rounded px-2 py-0.5 hover:bg-slate-900">
                      {isRealEstate ? (
                        <Building className="size-3" />
                      ) : (
                        <ShoppingCart className="size-3" />
                      )}
                      {isRealEstate ? 'Inventory' : 'Catalog'}
                    </div>
                    <div className="flex h-5 items-center gap-1.5 rounded px-2 py-0.5 hover:bg-slate-900">
                      <Layers className="size-3" /> Broadcasts
                    </div>
                  </div>

                  {/* Main Work Area Mock */}
                  <div className="flex flex-1 flex-col gap-3 overflow-hidden bg-slate-900/20 p-3">
                    {/* Header stat boxes */}
                    <div className="grid grid-cols-3 gap-2">
                      <div className="border-slate-850 flex flex-col gap-0.5 rounded-lg border bg-slate-950/80 p-2">
                        <span className="text-[10px] font-bold text-slate-500 uppercase">
                          {isRealEstate ? 'Total Leads' : 'Total Orders'}
                        </span>
                        <span className="text-sm font-black text-white">
                          {isRealEstate ? '412' : '1,284'}
                        </span>
                      </div>
                      <div className="border-slate-850 flex flex-col gap-0.5 rounded-lg border bg-slate-950/80 p-2">
                        <span className="text-[10px] font-bold text-slate-500 uppercase">
                          Active Inquiries
                        </span>
                        <span className="text-sm font-black text-indigo-400">
                          {isRealEstate ? '54' : '142'}
                        </span>
                      </div>
                      <div className="border-slate-850 flex flex-col gap-0.5 rounded-lg border bg-slate-950/80 p-2">
                        <span className="text-[10px] font-bold text-slate-500 uppercase">
                          {isRealEstate
                            ? 'Properties Matched'
                            : 'Cart Recovery'}
                        </span>
                        <span className="text-sm font-black text-emerald-400">
                          {isRealEstate ? '89%' : '42.8%'}
                        </span>
                      </div>
                    </div>

                    {/* Chat simulator & Details panel split */}
                    <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 md:grid-cols-12">
                      {/* Left Inbox Column */}
                      <div className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-slate-900 bg-slate-950 md:col-span-7">
                        <div className="flex shrink-0 items-center justify-between border-b border-slate-900 bg-slate-900/60 p-2">
                          <span className="flex items-center gap-1.5 font-bold text-white">
                            <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" />
                            Rajesh Kumar
                          </span>
                          <span className="text-[10px] text-slate-500">
                            {isRealEstate
                              ? 'JP Nagar, Bangalore'
                              : 'Shopify Store'}
                          </span>
                        </div>
                        <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-2">
                          <div className="max-w-[85%] self-start rounded-lg bg-slate-900/70 p-2">
                            <p className="text-[11px] text-slate-300">
                              {isRealEstate
                                ? 'Looking for a premium 3 BHK apartment or villa plot around JP Nagar. Budget 2-2.5 Cr. Send options.'
                                : 'Looking for a premium leather watch strap in dark brown, size 22mm. Budget is under 2,000 INR. Send options.'}
                            </p>
                            <span className="mt-1 block text-right text-[8px] text-slate-500">
                              11:05 AM
                            </span>
                          </div>
                          <div className="max-w-[85%] self-end rounded-lg border border-indigo-500/25 bg-indigo-600/25 p-2 text-slate-200">
                            <p className="text-[11px]">
                              {isRealEstate
                                ? 'Hi Rajesh, here is a list of handpicked properties matching your budget of ₹2.5 Cr in JP Nagar: convoreal.com/pvrealty?ref=pv'
                                : 'Hi Rajesh, here is our Classic Brown Leather Band matching your 22mm preference for ₹1,800: convoreal.com/shop?ref=store'}
                            </p>
                            <span className="mt-1 block text-right text-[8px] text-indigo-400">
                              11:07 AM · Delivered
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Right AI Match Suggestions */}
                      <div className="flex min-h-0 flex-col gap-2 overflow-y-auto rounded-lg border border-slate-900 bg-slate-950 p-2 md:col-span-5">
                        <span className="flex items-center gap-1 border-b border-slate-900 pb-1 text-[10px] font-bold tracking-wider text-slate-300 uppercase">
                          <Bot className="size-3.5 text-indigo-400" />
                          AI Match suggestions
                        </span>
                        <div className="flex flex-col gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-950/10 p-2">
                          <div className="flex items-start justify-between">
                            <span className="text-[11px] font-bold text-white">
                              {isRealEstate
                                ? 'JP Nagar Villa Plot'
                                : 'Classic Brown Band'}
                            </span>
                            <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[8px] font-bold text-emerald-400">
                              98% Match
                            </span>
                          </div>
                          <p className="text-[10px] text-slate-400">
                            {isRealEstate
                              ? '1200 Sq.Ft · ₹2.1 Cr · Owner Direct'
                              : '22mm Italian Calfskin · ₹1,800 · In Stock'}
                          </p>
                          <div className="mt-0.5 flex gap-1.5">
                            <button className="cursor-default rounded bg-emerald-500 px-2 py-0.5 text-[9px] font-bold text-slate-950">
                              Share via WA
                            </button>
                            <button className="cursor-default rounded border border-slate-800 px-2 py-0.5 text-[9px] text-slate-300 hover:bg-slate-900">
                              View Details
                            </button>
                          </div>
                        </div>
                        <div className="flex flex-col gap-1.5 rounded-lg border border-indigo-500/20 bg-slate-900/30 p-2 opacity-60">
                          <div className="flex items-start justify-between">
                            <span className="text-[11px] font-bold text-white">
                              {isRealEstate
                                ? 'Sobha Clovelly 3BHK'
                                : 'Vintage Leather Strap'}
                            </span>
                            <span className="rounded bg-indigo-500/10 px-1.5 py-0.5 text-[8px] font-bold text-indigo-400">
                              82% Match
                            </span>
                          </div>
                          <p className="text-[10px] font-medium text-slate-400">
                            {isRealEstate
                              ? '2100 Sq.Ft · ₹2.7 Cr · Agent Referred'
                              : '22mm Genuine Leather · ₹1,500 · Out of Stock'}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Feature Grid Section */}
        <section
          id="features"
          className="border-t border-slate-900 bg-slate-900/30 py-20"
        >
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="mx-auto mb-16 max-w-3xl text-center">
              <h2 className="text-3xl font-black tracking-tight text-white sm:text-4xl">
                Supercharge Your Inbound Inquiries
              </h2>
              <p className="mt-4 text-sm font-medium text-slate-400 sm:text-base">
                ConvoReal integrates directly with WhatsApp to capture
                customers, catalog inventory, and broadcast updates instantly.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-8 md:grid-cols-3">
              {MARKETING_CONFIG.features.map((feature, idx) => (
                <div
                  key={idx}
                  className="flex flex-col gap-4 rounded-2xl border border-slate-900 bg-slate-950 p-6 transition-all hover:scale-[1.02] hover:border-indigo-500/30"
                >
                  <div className="flex size-10 shrink-0 animate-pulse items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-400">
                    {renderIcon(feature.icon)}
                  </div>
                  <h3 className="text-lg font-bold text-white">
                    {feature.title}
                  </h3>
                  <p className="text-sm leading-relaxed font-medium text-slate-400">
                    {feature.description}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Interactive Feature Showcases */}
        <section id="demo" className="relative overflow-hidden py-20">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="mb-12 flex flex-col justify-between md:flex-row md:items-end">
              <div className="max-w-3xl">
                <span className="text-xs font-black tracking-wider text-indigo-400 uppercase">
                  Try it Live
                </span>
                <h2 className="mt-2 text-3xl font-black tracking-tight text-white sm:text-4xl">
                  See Our Hero Features in Action
                </h2>
                <p className="mt-4 text-sm font-medium text-slate-400 sm:text-base">
                  Interact with real-time simulations of the core engines. Slide
                  through or use the arrows to explore.
                </p>
              </div>
              <div className="mt-6 flex gap-2 md:mt-0">
                <button
                  onClick={() => scroll('left')}
                  className="cursor-pointer rounded-full border border-slate-800 bg-slate-900/80 p-3 text-slate-400 shadow-xl transition-all hover:bg-indigo-600 hover:text-white"
                  aria-label="Scroll Left"
                >
                  <ChevronLeft className="size-4" />
                </button>
                <button
                  onClick={() => scroll('right')}
                  className="cursor-pointer rounded-full border border-slate-800 bg-slate-900/80 p-3 text-slate-400 shadow-xl transition-all hover:bg-indigo-600 hover:text-white"
                  aria-label="Scroll Right"
                >
                  <ChevronRight className="size-4" />
                </button>
              </div>
            </div>

            {/* Scroller Container */}
            <div
              ref={scrollContainerRef}
              className="flex snap-x snap-mandatory gap-6 overflow-x-auto scroll-smooth py-4"
              style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
            >
              {/* CARD 1: AI Chat Ingestion */}
              <div className="relative flex h-[450px] w-[88vw] shrink-0 snap-center flex-col justify-between rounded-3xl border border-slate-800/80 bg-slate-900/40 p-6 shadow-2xl backdrop-blur-sm transition-all hover:border-indigo-500/20 sm:w-[480px]">
                <div className="flex flex-col gap-3.5">
                  <div className="flex items-center gap-3">
                    <div className="flex size-8 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-400">
                      <MessageSquare className="size-4.5" />
                    </div>
                    <span className="text-xs font-black tracking-widest text-slate-500 uppercase">
                      1. WhatsApp AI Parser
                    </span>
                  </div>
                  <h3 className="text-lg font-bold tracking-tight text-white">
                    Lead Chat Ingestion
                  </h3>

                  {/* Dynamic Inner Panel */}
                  <div className="border-slate-850 h-[210px] overflow-y-auto rounded-xl border bg-slate-950 p-4 text-[11px] leading-relaxed select-none">
                    {demoStep === 'idle' && (
                      <div className="space-y-1 font-mono text-slate-400">
                        <span className="mb-1.5 block font-bold text-slate-500">
                          {'// Messy chat message forwarded to the Engine:'}
                        </span>
                        &ldquo;{MARKETING_CONFIG.demo.mockMessage}&rdquo;
                      </div>
                    )}

                    {demoStep === 'parsing' && (
                      <div className="flex h-full flex-col justify-center space-y-3.5 px-2">
                        <div className="h-3.5 w-2/3 animate-pulse rounded-full bg-slate-900" />
                        <div className="h-2.5 w-1/2 animate-pulse rounded-full bg-slate-900" />
                        <div className="h-8 w-full animate-pulse rounded-lg bg-slate-900" />
                        <div className="h-2.5 w-3/4 animate-pulse rounded-full bg-slate-900" />
                      </div>
                    )}

                    {demoStep === 'completed' && (
                      <div className="animate-fade-in space-y-3">
                        <div className="flex items-center justify-between border-b border-slate-900 pb-2">
                          <div>
                            <h4 className="flex items-center gap-1.5 text-xs font-bold text-white">
                              {MARKETING_CONFIG.demo.parsedCard.name}
                              <span className="size-1.5 rounded-full bg-emerald-500" />
                            </h4>
                            <span className="text-[9px] text-slate-400">
                              {MARKETING_CONFIG.demo.parsedCard.contact}
                            </span>
                          </div>
                          <span className="rounded-full border border-indigo-500/20 bg-indigo-500/10 px-2 py-0.5 text-[8px] font-black text-indigo-400">
                            {MARKETING_CONFIG.demo.parsedCard.badge}
                          </span>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-[9px] text-slate-300">
                          {MARKETING_CONFIG.demo.parsedCard.fields.map(
                            (f, i) => (
                              <div key={i}>
                                <span className="block text-[7px] font-bold tracking-wide text-slate-500 uppercase">
                                  {f.label}
                                </span>
                                <span
                                  className={
                                    f.isHighlight
                                      ? 'font-bold text-emerald-400'
                                      : ''
                                  }
                                >
                                  {f.value}
                                </span>
                              </div>
                            )
                          )}
                        </div>
                        <div className="flex items-center justify-between rounded-lg border border-emerald-500/20 bg-emerald-950/10 p-2 text-[8px]">
                          <div>
                            <span className="block font-bold text-white">
                              Auto-Matched Listing
                            </span>
                            <span className="text-slate-400">
                              {
                                MARKETING_CONFIG.demo.parsedCard.matchedItem
                                  .title
                              }
                            </span>
                          </div>
                          <span className="rounded bg-emerald-400 px-1 font-black text-slate-950">
                            {
                              MARKETING_CONFIG.demo.parsedCard.matchedItem
                                .percentage
                            }
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Footer buttons */}
                <div>
                  {demoStep === 'idle' && (
                    <Button
                      onClick={handleSimulateParse}
                      className="flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-xl bg-indigo-600 py-2.5 text-xs font-bold text-white hover:bg-indigo-500"
                    >
                      <Bot className="size-3.5" /> Simulate AI Parse Ingestion
                    </Button>
                  )}
                  {demoStep === 'parsing' && (
                    <Button
                      disabled
                      className="flex w-full cursor-not-allowed items-center justify-center gap-1.5 rounded-xl bg-slate-800 py-2.5 text-xs font-bold text-slate-400"
                    >
                      <div className="size-3 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />{' '}
                      Ingesting and matching...
                    </Button>
                  )}
                  {demoStep === 'completed' && (
                    <Button
                      onClick={() => setDemoStep('idle')}
                      className="w-full cursor-pointer rounded-xl border border-slate-800 bg-slate-900 py-2.5 text-xs font-bold text-slate-200 transition-all hover:bg-slate-800"
                    >
                      Reset Simulation
                    </Button>
                  )}
                </div>
              </div>

              {/* CARD 2: Gemini Copywriter */}
              <div className="relative flex h-[450px] w-[88vw] shrink-0 snap-center flex-col justify-between rounded-3xl border border-slate-800/80 bg-slate-900/40 p-6 shadow-2xl backdrop-blur-sm transition-all hover:border-indigo-500/20 sm:w-[480px]">
                <div className="flex flex-col gap-3.5">
                  <div className="flex items-center gap-3">
                    <div className="flex size-8 items-center justify-center rounded-lg bg-violet-500/10 text-violet-400">
                      <Sparkles className="size-4.5" />
                    </div>
                    <span className="text-xs font-black tracking-widest text-slate-500 uppercase">
                      2. Gemini Description Writer
                    </span>
                  </div>
                  <h3 className="text-lg font-bold tracking-tight text-white">
                    AI Copywriting Generator
                  </h3>

                  {/* Dynamic Inner Panel */}
                  <div className="border-slate-850 h-[210px] overflow-y-auto rounded-xl border bg-slate-950 p-4 text-[11px] leading-relaxed select-none">
                    {copyStep === 'idle' && (
                      <div className="text-slate-350 space-y-2">
                        <span className="mb-1.5 block font-bold text-slate-500">
                          {'// Basic specifications captured from agent:'}
                        </span>
                        {isRealEstate ? (
                          <>
                            <div className="flex justify-between border-b border-slate-900 pb-1">
                              <span className="text-slate-500">
                                Property Category
                              </span>
                              <span className="font-semibold text-slate-200">
                                Residential Flat (3 BHK)
                              </span>
                            </div>
                            <div className="flex justify-between border-b border-slate-900 pb-1">
                              <span className="text-slate-500">Location</span>
                              <span className="font-semibold text-slate-200">
                                HSR Layout Sector 3
                              </span>
                            </div>
                            <div className="flex justify-between border-b border-slate-900 pb-1">
                              <span className="text-slate-500">
                                Asking Price
                              </span>
                              <span className="font-semibold text-slate-200">
                                ₹2.4 Crores
                              </span>
                            </div>
                            <div className="flex justify-between border-b border-slate-900 pb-1">
                              <span className="text-slate-500">
                                Key Features
                              </span>
                              <span className="font-semibold text-slate-200">
                                Gym, Swimming pool, Metro nearby
                              </span>
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="flex justify-between border-b border-slate-900 pb-1">
                              <span className="text-slate-500">
                                Product Category
                              </span>
                              <span className="font-semibold text-slate-200">
                                Calfskin Watch Strap
                              </span>
                            </div>
                            <div className="flex justify-between border-b border-slate-900 pb-1">
                              <span className="text-slate-500">
                                Size / Color
                              </span>
                              <span className="font-semibold text-slate-200">
                                22mm / Dark Brown
                              </span>
                            </div>
                            <div className="flex justify-between border-b border-slate-900 pb-1">
                              <span className="text-slate-500">Price</span>
                              <span className="font-semibold text-slate-200">
                                ₹1,800
                              </span>
                            </div>
                            <div className="flex justify-between border-b border-slate-900 pb-1">
                              <span className="text-slate-500">
                                Stock Availability
                              </span>
                              <span className="font-semibold text-slate-200">
                                15 units left
                              </span>
                            </div>
                          </>
                        )}
                      </div>
                    )}

                    {copyStep === 'writing' && (
                      <div className="flex h-full flex-col justify-center space-y-3.5 px-2">
                        <div className="h-3.5 w-3/4 animate-pulse rounded-full bg-slate-900" />
                        <div className="h-2.5 w-5/6 animate-pulse rounded-full bg-slate-900" />
                        <div className="h-2.5 w-2/3 animate-pulse rounded-full bg-slate-900" />
                        <div className="h-2.5 w-1/2 animate-pulse rounded-full bg-slate-900" />
                      </div>
                    )}

                    {copyStep === 'completed' && (
                      <div className="animate-fade-in space-y-2 font-mono text-[10px] leading-normal whitespace-pre-wrap text-slate-300">
                        {isRealEstate
                          ? `🏡 **LUXURIOUS 3 BHK RESIDENCE IN HSR LAYOUT**

Experience modern luxury at its finest! Nestled in a prime gated community in HSR Layout, this spacious 3 BHK apartment offers the perfect blend of elegance and convenience.

✨ **Key Highlights:**
• 🏊‍♂️ Premium Swimming Pool & Fully Equipped Gym
• 🚇 Unbeatable location — minutes away from the metro
• 🛡️ 24/7 Gated Security & Dedicated Car Parking

*Asking Price: ₹2.4 Crores*
*Direct Owner Listing.*`
                          : `⌚ **CLASSIC DARK BROWN LEATHER STRAP (22mm)**

Upgrade your timepiece with Italian craftsmanship. Made from genuine calfskin leather, this 22mm watch band features detailed hand-stitching and a brushed stainless steel buckle.

✨ **Key Highlights:**
• 🇮🇹 100% Genuine Italian Calfskin
• 📐 Compatibility: Fits any watch with standard 22mm lugs
• 🛡️ Quick-release spring bars for hassle-free swaps

*Retail Price: ₹1,800*
*In Stock — Ships Next Day!*`}
                      </div>
                    )}
                  </div>
                </div>

                {/* Footer buttons */}
                <div>
                  {copyStep === 'idle' && (
                    <Button
                      onClick={handleSimulateCopy}
                      className="flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-xl bg-indigo-600 py-2.5 text-xs font-bold text-white hover:bg-indigo-500"
                    >
                      <Sparkles className="size-3.5" /> Generate AI Copywriting
                    </Button>
                  )}
                  {copyStep === 'writing' && (
                    <Button
                      disabled
                      className="flex w-full cursor-not-allowed items-center justify-center gap-1.5 rounded-xl bg-slate-800 py-2.5 text-xs font-bold text-slate-400"
                    >
                      <div className="size-3 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />{' '}
                      Gemini generating ad copy...
                    </Button>
                  )}
                  {copyStep === 'completed' && (
                    <Button
                      onClick={() => setCopyStep('idle')}
                      className="w-full cursor-pointer rounded-xl border border-slate-800 bg-slate-900 py-2.5 text-xs font-bold text-slate-200 transition-all hover:bg-slate-800"
                    >
                      Reset Simulation
                    </Button>
                  )}
                </div>
              </div>

              {/* CARD 3: Smart Match & ROI Filters */}
              <div className="relative flex h-[450px] w-[88vw] shrink-0 snap-center flex-col justify-between rounded-3xl border border-slate-800/80 bg-slate-900/40 p-6 shadow-2xl backdrop-blur-sm transition-all hover:border-indigo-500/20 sm:w-[480px]">
                <div className="flex flex-col gap-3.5">
                  <div className="flex items-center gap-3">
                    <div className="flex size-8 items-center justify-center rounded-lg bg-amber-500/10 text-amber-400">
                      <Zap className="size-4.5" />
                    </div>
                    <span className="text-xs font-black tracking-widest text-slate-500 uppercase">
                      3. Smart Matching & Yields
                    </span>
                  </div>
                  <h3 className="text-lg font-bold tracking-tight text-white">
                    Criteria Compatibility Engine
                  </h3>

                  {/* Dynamic Inner Panel */}
                  <div className="border-slate-850 h-[210px] overflow-y-auto rounded-xl border bg-slate-950 p-4 text-[11px] leading-relaxed select-none">
                    {matchStep === 'idle' && (
                      <div className="text-slate-350 space-y-2">
                        <span className="mb-1.5 block font-bold text-slate-500">
                          {'// Buyer preferences mapped in the Engine:'}
                        </span>
                        <div className="flex justify-between border-b border-slate-900 pb-1">
                          <span className="text-slate-500">Client Profile</span>
                          <span className="font-semibold text-slate-200">
                            Vikram Malhotra (Investor)
                          </span>
                        </div>
                        <div className="flex justify-between border-b border-slate-900 pb-1">
                          <span className="text-slate-500">Max Budget</span>
                          <span className="font-semibold text-slate-200">
                            ₹15.0 Crore
                          </span>
                        </div>
                        {isRealEstate ? (
                          <>
                            <div className="flex justify-between border-b border-slate-900 pb-1">
                              <span className="text-slate-500">
                                Preferred Type
                              </span>
                              <span className="font-semibold text-slate-200">
                                Commercial Complex / Building
                              </span>
                            </div>
                            <div className="flex justify-between border-b border-slate-900 pb-1">
                              <span className="text-slate-500">
                                Expected Yield
                              </span>
                              <span className="font-black text-amber-400">
                                Min 5.5% ROI
                              </span>
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="flex justify-between border-b border-slate-900 pb-1">
                              <span className="text-slate-500">
                                Preferred Category
                              </span>
                              <span className="font-semibold text-slate-200">
                                Leather Watch Straps
                              </span>
                            </div>
                            <div className="flex justify-between border-b border-slate-900 pb-1">
                              <span className="text-slate-500">
                                Target Size
                              </span>
                              <span className="font-black text-amber-400">
                                22mm Wide
                              </span>
                            </div>
                          </>
                        )}
                      </div>
                    )}

                    {matchStep === 'matching' && (
                      <div className="flex h-full flex-col justify-center space-y-3.5 px-2">
                        <div className="h-3.5 w-2/3 animate-pulse rounded-full bg-slate-900" />
                        <div className="h-8 w-full animate-pulse rounded-lg bg-slate-900" />
                        <div className="h-8 w-full animate-pulse rounded-lg bg-slate-900" />
                      </div>
                    )}

                    {matchStep === 'completed' && (
                      <div className="animate-fade-in space-y-2.5 text-[10px]">
                        <span className="mb-1 block font-bold text-slate-500">
                          {'// Matched catalog items (Sorted by score):'}
                        </span>

                        {isRealEstate ? (
                          <>
                            <div className="flex items-center justify-between rounded-xl border border-indigo-500/25 bg-indigo-950/10 p-2.5">
                              <div>
                                <span className="block text-[11px] font-bold text-white">
                                  1. Indiranagar Office Block
                                </span>
                                <span className="text-[9px] text-slate-400">
                                  Price: ₹13.8 Cr · ROI: 6.2% Yield · 100ft road
                                </span>
                              </div>
                              <span className="rounded bg-indigo-500 px-1.5 py-0.5 text-[8px] font-black text-white">
                                98% Match
                              </span>
                            </div>
                            <div className="flex items-center justify-between rounded-xl border border-slate-900 bg-slate-950 p-2.5">
                              <div>
                                <span className="block text-[11px] font-semibold text-slate-200">
                                  2. Koramangala Commercial Hub
                                </span>
                                <span className="text-[9px] text-slate-500">
                                  Price: ₹14.5 Cr · ROI: 5.6% Yield · Sector 4
                                </span>
                              </div>
                              <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[8px] font-bold text-slate-400">
                                88% Match
                              </span>
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="flex items-center justify-between rounded-xl border border-indigo-500/25 bg-indigo-950/10 p-2.5">
                              <div>
                                <span className="block text-[11px] font-bold text-white">
                                  1. Classic Brown Leather Band
                                </span>
                                <span className="text-[9px] text-slate-400">
                                  Price: ₹1,800 · Size: 22mm · In Stock
                                </span>
                              </div>
                              <span className="rounded bg-indigo-500 px-1.5 py-0.5 text-[8px] font-black text-white">
                                95% Match
                              </span>
                            </div>
                            <div className="flex items-center justify-between rounded-xl border border-slate-900 bg-slate-950 p-2.5">
                              <div>
                                <span className="block text-[11px] font-semibold text-slate-200">
                                  2. Premium Tan Suede Strap
                                </span>
                                <span className="text-[9px] text-slate-500">
                                  Price: ₹1,950 · Size: 22mm · Low Stock
                                </span>
                              </div>
                              <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[8px] font-bold text-slate-400">
                                85% Match
                              </span>
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Footer buttons */}
                <div>
                  {matchStep === 'idle' && (
                    <Button
                      onClick={handleSimulateMatch}
                      className="flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-xl bg-indigo-600 py-2.5 text-xs font-bold text-white hover:bg-indigo-500"
                    >
                      <Zap className="size-3.5" /> Find Inventory Matches
                    </Button>
                  )}
                  {matchStep === 'matching' && (
                    <Button
                      disabled
                      className="flex w-full cursor-not-allowed items-center justify-center gap-1.5 rounded-xl bg-slate-800 py-2.5 text-xs font-bold text-slate-400"
                    >
                      <div className="size-3 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />{' '}
                      Querying inventory list...
                    </Button>
                  )}
                  {matchStep === 'completed' && (
                    <Button
                      onClick={() => setMatchStep('idle')}
                      className="w-full cursor-pointer rounded-xl border border-slate-800 bg-slate-900 py-2.5 text-xs font-bold text-slate-200 transition-all hover:bg-slate-800"
                    >
                      Reset Simulation
                    </Button>
                  )}
                </div>
              </div>

              {/* CARD 4: Branded Showcase Portal */}
              <div className="relative flex h-[450px] w-[88vw] shrink-0 snap-center flex-col justify-between rounded-3xl border border-slate-800/80 bg-slate-900/40 p-6 shadow-2xl backdrop-blur-sm transition-all hover:border-indigo-500/20 sm:w-[480px]">
                <div className="flex flex-col gap-3.5">
                  <div className="flex items-center gap-3">
                    <div className="flex size-8 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400">
                      <Globe className="size-4.5" />
                    </div>
                    <span className="text-xs font-black tracking-widest text-slate-500 uppercase">
                      4. Branded Showcase Portal
                    </span>
                  </div>
                  <h3 className="text-lg font-bold tracking-tight text-white">
                    Public Catalog Showcase
                  </h3>

                  {/* Dynamic Inner Panel */}
                  <div className="border-slate-850 flex h-[210px] flex-col justify-center overflow-y-auto rounded-xl border bg-slate-950 p-4 text-[11px] leading-relaxed select-none">
                    {showcaseStep === 'idle' && (
                      <div className="text-slate-350 space-y-2">
                        <span className="mb-1.5 block font-bold text-slate-500">
                          {'// Configure custom portal mapping:'}
                        </span>
                        <div className="flex items-center justify-between border-b border-slate-900 pb-1.5">
                          <span className="text-slate-500">Showcase Brand</span>
                          <span className="font-semibold text-slate-200">
                            {isRealEstate
                              ? 'Aryavarta Ventures'
                              : 'Boutique Watch'}
                          </span>
                        </div>
                        <div className="flex items-center justify-between border-b border-slate-900 pb-1.5">
                          <span className="text-slate-500">Live URL</span>
                          <span className="font-mono text-indigo-400">
                            {isRealEstate
                              ? 'pv-realty.convoreal.com'
                              : 'boutique.convoreal.com'}
                          </span>
                        </div>
                        <div className="flex items-center justify-between border-b border-slate-900 pb-1.5">
                          <span className="text-slate-500">Domain Status</span>
                          <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-1.5 text-[8px] font-bold text-emerald-400">
                            SSL Secured
                          </span>
                        </div>
                      </div>
                    )}

                    {showcaseStep === 'loading' && (
                      <div className="flex h-full flex-col justify-center space-y-3.5 px-2">
                        <div className="h-3.5 w-1/2 animate-pulse rounded-full bg-slate-900" />
                        <div className="h-3.5 w-2/3 animate-pulse rounded-full bg-slate-900" />
                        <div className="h-3.5 w-1/3 animate-pulse rounded-full bg-slate-900" />
                      </div>
                    )}

                    {showcaseStep === 'completed' && (
                      <div className="animate-fade-in flex flex-1 flex-col justify-between space-y-2 text-[10px]">
                        {/* Domain bar mock */}
                        <div className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900/60 px-2.5 py-1.5">
                          <div className="flex items-center gap-1.5">
                            <div className="flex size-3.5 items-center justify-center rounded bg-indigo-600 text-[8px] font-extrabold text-white">
                              C
                            </div>
                            <span className="text-[8px] font-extrabold text-white">
                              {isRealEstate
                                ? 'Aryavarta Ventures'
                                : 'Boutique Watch'}{' '}
                              Portal
                            </span>
                          </div>
                          <span className="font-mono text-[7px] text-slate-400">
                            listings.yourdomain.com
                          </span>
                        </div>

                        {/* Image Showcase Card */}
                        {isRealEstate ? (
                          <div className="flex flex-col gap-1.5 overflow-hidden rounded-xl border border-slate-900 bg-slate-950 p-1.5 shadow-lg">
                            <div className="relative h-[95px] w-full overflow-hidden rounded-lg border border-slate-900">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src="https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=400&h=200&q=80"
                                alt="Stunning Modern Villa"
                                className="h-full w-full object-cover"
                              />
                              <span className="absolute top-1.5 right-1.5 rounded bg-indigo-600/90 px-1.5 py-0.5 text-[8px] font-extrabold tracking-wide text-white shadow-md">
                                ₹4.4 Cr
                              </span>
                              <span className="absolute bottom-1.5 left-1.5 rounded bg-emerald-500/90 px-1.5 py-0.5 text-[7px] font-black tracking-wide text-slate-950">
                                98% Match
                              </span>
                            </div>
                            <div className="flex flex-col gap-0.5 px-1">
                              <div className="flex items-center justify-between">
                                <span className="text-[10px] font-extrabold text-slate-200">
                                  JP Nagar Luxury Villa Plot
                                </span>
                                <span className="text-[8px] text-slate-500">
                                  Direct Owner
                                </span>
                              </div>
                              <span className="block text-left text-[8px] text-slate-400">
                                Devanahalli · 4200 Sq.Ft · Gated Layout
                              </span>
                            </div>
                            <span className="flex w-full cursor-default items-center justify-center gap-1 rounded-lg bg-emerald-500 py-1.5 text-center text-[8px] font-extrabold text-slate-950">
                              💬 Inquire on WhatsApp
                            </span>
                          </div>
                        ) : (
                          <div className="flex flex-col gap-1.5 overflow-hidden rounded-xl border border-slate-900 bg-slate-950 p-1.5 shadow-lg">
                            <div className="relative h-[95px] w-full overflow-hidden rounded-lg border border-slate-900">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src="https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=400&h=200&q=80"
                                alt="Classic Brown Watch Strap"
                                className="h-full w-full object-cover"
                              />
                              <span className="absolute top-1.5 right-1.5 rounded bg-indigo-600/90 px-1.5 py-0.5 text-[8px] font-extrabold tracking-wide text-white shadow-md">
                                ₹1,800
                              </span>
                              <span className="absolute bottom-1.5 left-1.5 rounded bg-emerald-500/90 px-1.5 py-0.5 text-[7px] font-black tracking-wide text-slate-950">
                                95% Match
                              </span>
                            </div>
                            <div className="flex flex-col gap-0.5 px-1">
                              <div className="flex items-center justify-between">
                                <span className="text-[10px] font-extrabold text-slate-200">
                                  Classic Italian Leather Strap
                                </span>
                                <span className="text-[8px] text-slate-500">
                                  In Stock
                                </span>
                              </div>
                              <span className="block text-left text-[8px] text-slate-400">
                                22mm Dark Brown · Genuine Calfskin
                              </span>
                            </div>
                            <span className="flex w-full cursor-default items-center justify-center gap-1 rounded-lg bg-emerald-500 py-1.5 text-center text-[8px] font-extrabold text-slate-950">
                              💬 Buy on WhatsApp
                            </span>
                          </div>
                        )}
                        <span className="mt-0.5 block text-center text-[7px] font-bold text-slate-500">
                          ✓ Syncs with listings in your database instantly.
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Footer buttons */}
                <div>
                  {showcaseStep === 'idle' && (
                    <Button
                      onClick={handleSimulateShowcase}
                      className="flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-xl bg-indigo-600 py-2.5 text-xs font-bold text-white hover:bg-indigo-500"
                    >
                      <Globe className="size-3.5" /> Activate Live Showcase
                    </Button>
                  )}
                  {showcaseStep === 'loading' && (
                    <Button
                      disabled
                      className="flex w-full cursor-not-allowed items-center justify-center gap-1.5 rounded-xl bg-slate-800 py-2.5 text-xs font-bold text-slate-400"
                    >
                      <div className="size-3 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />{' '}
                      Provisioning portal CDN dns...
                    </Button>
                  )}
                  {showcaseStep === 'completed' && (
                    <Button
                      onClick={() => setShowcaseStep('idle')}
                      className="w-full cursor-pointer rounded-xl border border-slate-800 bg-slate-900 py-2.5 text-xs font-bold text-slate-200 transition-all hover:bg-slate-800"
                    >
                      Reset Simulation
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>

        {isRealEstate && (
          <section id="tools" className="border-t border-slate-900 py-20">
            <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
              <div className="mb-12 flex flex-col justify-between gap-6 md:flex-row md:items-end">
                <div className="max-w-3xl">
                  <span className="text-xs font-black tracking-wider text-emerald-400 uppercase">
                    Free, no sign-in
                  </span>
                  <h2 className="mt-2 text-3xl font-black tracking-tight text-white sm:text-4xl">
                    Tools buyers and agents search for every day
                  </h2>
                  <p className="mt-4 text-sm font-medium text-slate-400 sm:text-base">
                    Guidance value, stamp duty, EMI, rental yield and process
                    guides, the engines that run inside {BRANDING.name}, open to
                    everyone. Try them, then bring them into your workspace.
                  </p>
                </div>
                <a
                  href={TOOLS_PATH}
                  className="inline-flex w-fit items-center gap-2 text-sm font-bold text-indigo-300 hover:text-indigo-200"
                >
                  All free tools <ArrowRight className="size-4" />
                </a>
              </div>
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                {PUBLIC_TOOLS.map((tool) => {
                  return (
                    <a
                      key={tool.slug}
                      href={tool.path}
                      className="group flex flex-col gap-4 rounded-2xl border border-slate-900 bg-slate-950 p-7 transition-all hover:scale-[1.01] hover:border-emerald-500/40"
                    >
                      <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-400">
                        <ToolIcon icon={tool.icon} className="size-5" />
                      </div>
                      <h3 className="text-xl font-bold text-white">
                        {tool.name}
                      </h3>
                      <p className="flex-1 text-sm leading-relaxed font-medium text-slate-400">
                        {tool.summary}
                      </p>
                      <span className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-300 group-hover:text-emerald-200">
                        {tool.cta} <ArrowRight className="size-3.5" />
                      </span>
                    </a>
                  );
                })}
              </div>
            </div>
          </section>
        )}

        {/* Pricing Plan Cards */}
        <section
          id="pricing"
          className="border-t border-slate-900 bg-slate-900/30 py-20"
        >
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="mx-auto mb-16 max-w-3xl text-center">
              <span className="text-xs font-black tracking-wider text-indigo-400 uppercase">
                Simple Pricing
              </span>
              <h2 className="mt-2 text-3xl font-black tracking-tight text-white sm:text-4xl">
                Plans Built for Every Scale
              </h2>
              <p className="mt-4 text-sm font-medium text-slate-400 sm:text-base">
                Choose the pricing plan that fits your business size. Start
                free, upgrade as you grow.
              </p>
            </div>

            <div className="mx-auto grid max-w-7xl grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
              {MARKETING_CONFIG.pricing.map((plan, idx) => (
                <div
                  key={idx}
                  className={`relative flex flex-col gap-6 rounded-2xl bg-slate-950 p-6 shadow-lg ${
                    plan.isPopular
                      ? 'border-2 border-indigo-600 shadow-2xl shadow-indigo-600/5'
                      : 'border border-slate-900'
                  }`}
                >
                  {plan.isPopular && (
                    <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 rounded-full bg-indigo-600 px-3 py-1 text-[10px] font-black tracking-wider text-white uppercase">
                      Most Popular
                    </div>
                  )}
                  <div>
                    <h3 className="text-lg font-bold text-white">
                      {plan.name}
                    </h3>
                    <p className="mt-1 text-xs text-slate-500">
                      {plan.description}
                    </p>
                  </div>
                  <div className="flex items-baseline gap-1">
                    <span className="text-4xl font-black text-white">
                      {plan.price}
                    </span>
                    <span className="text-xs text-slate-400">
                      / {plan.period}
                    </span>
                  </div>
                  <Button
                    onClick={() => router.push('/signup')}
                    className={`w-full cursor-pointer rounded-xl py-3.5 font-bold transition-all ${
                      plan.isPopular
                        ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/25 hover:bg-indigo-500'
                        : 'border border-slate-800 bg-slate-900 text-slate-200 hover:bg-slate-800'
                    }`}
                  >
                    {plan.price === '₹0' ? 'Get Started' : 'Start Free Trial'}
                  </Button>
                  <ul className="text-slate-350 space-y-3.5 border-t border-slate-900 pt-6 text-xs">
                    {plan.features.map((feat, fidx) => (
                      <li key={fidx} className="flex items-center gap-2">
                        <Check className="size-4 shrink-0 text-indigo-400" />
                        {feat}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Talk to us — prospect qualification funnel */}
        <section
          id="get-started"
          className="border-t border-slate-900 bg-slate-900/30 py-20"
        >
          <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
            <div className="mb-10 text-center">
              <span className="text-xs font-black tracking-wider text-indigo-400 uppercase">
                Get Started
              </span>
              <h2 className="mt-2 text-3xl font-black tracking-tight text-white sm:text-4xl">
                See {BRANDING.name} on your listings
              </h2>
              <p className="mx-auto mt-3 max-w-xl text-slate-400">
                Tell us a bit about your business and we&apos;ll get you set up
                on WhatsApp — no credit card, no software to install.
              </p>
            </div>
            <div className="mx-auto max-w-lg">
              {showLeadForm ? (
                <EngineLeadForm />
              ) : (
                <EngineLeadBot variant="inline" />
              )}
              <button
                type="button"
                onClick={() => setShowLeadForm((v) => !v)}
                className="mt-3 w-full cursor-pointer text-center text-xs font-semibold text-slate-500 hover:text-slate-300"
              >
                {showLeadForm
                  ? 'Rather just chat? Talk to the assistant'
                  : 'Prefer a plain form? Switch to the form'}
              </button>
            </div>
          </div>
        </section>

        {/* FAQ Section */}
        <section
          id="faq"
          className="relative mx-auto max-w-4xl px-4 py-20 sm:px-6 lg:px-8"
        >
          <div className="mb-16 text-center">
            <span className="text-xs font-black tracking-wider text-indigo-400 uppercase">
              Got Questions?
            </span>
            <h2 className="mt-2 text-3xl font-black tracking-tight text-white sm:text-4xl">
              Frequently Asked Questions
            </h2>
          </div>

          <div className="space-y-4">
            {MARKETING_CONFIG.faqs.map((faq, idx) => (
              <div
                key={idx}
                className="overflow-hidden rounded-xl border border-slate-900 bg-slate-900/40 transition-colors"
              >
                <button
                  onClick={() => toggleFaq(idx)}
                  className="flex w-full cursor-pointer items-center justify-between px-5 py-4 text-left text-sm font-bold text-white transition-colors hover:text-indigo-400 sm:text-base"
                >
                  <span>{faq.q}</span>
                  <ChevronDown
                    className={`size-4 shrink-0 text-slate-400 transition-transform duration-255 ${faqOpen[idx] ? 'rotate-180 text-indigo-400' : ''}`}
                  />
                </button>
                <div
                  className={`overflow-hidden transition-all duration-255 ${
                    faqOpen[idx]
                      ? 'max-h-60 border-t border-slate-900/60'
                      : 'max-h-0'
                  }`}
                >
                  <p className="px-5 py-4 text-xs leading-relaxed font-medium text-slate-400 sm:text-sm">
                    {faq.a}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Bottom CTA Banner */}
        <section className="relative py-20">
          <div className="mx-auto max-w-5xl px-4 text-center sm:px-6 lg:px-8">
            <div className="relative overflow-hidden rounded-3xl border border-slate-800 bg-gradient-to-r from-slate-900 to-indigo-950/40 p-8 shadow-2xl sm:p-12">
              <div className="absolute -top-20 -right-20 h-80 w-80 rounded-full bg-indigo-500/10 blur-[80px]" />
              <div className="absolute -bottom-20 -left-20 h-60 w-60 rounded-full bg-emerald-500/10 blur-[80px]" />

              <div className="relative z-10 space-y-6">
                <h2 className="text-3xl font-black tracking-tight text-white sm:text-4xl">
                  Supercharge Your Inbound Pipeline
                </h2>
                <p className="mx-auto max-w-xl text-sm leading-relaxed font-medium text-slate-400">
                  Connect your WhatsApp business account and start importing
                  contacts and listings within 5 minutes. No credit card
                  required.
                </p>
                <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
                  <Button
                    onClick={() => router.push('/signup')}
                    className="w-full cursor-pointer rounded-xl bg-indigo-600 px-8 py-5 text-xs font-bold text-white shadow-lg shadow-indigo-600/20 transition-all hover:scale-102 hover:bg-indigo-500 sm:w-auto"
                  >
                    Create Free Account
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => router.push('/login')}
                    className="border-slate-850 w-full cursor-pointer rounded-xl bg-slate-950 px-8 py-5 text-xs font-semibold text-slate-200 hover:bg-slate-900 sm:w-auto"
                  >
                    Portal Login
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="z-10 border-t border-slate-900 bg-slate-950 py-10">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-6 px-4 text-xs text-slate-500 sm:flex-row sm:px-6 lg:px-8">
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded-md bg-indigo-600 text-xs font-black tracking-tighter text-white">
              C
            </div>
            <span className="text-slate-350 font-bold">ConvoReal</span>
          </div>
          <p className="font-medium">
            &copy; {new Date().getFullYear()} ConvoReal. All rights reserved.
          </p>
          <div className="flex items-center gap-6 font-semibold">
            {isRealEstate && (
              <Link href={TOOLS_PATH} className="hover:text-slate-300">
                Free Tools
              </Link>
            )}
            <Link href="/help" className="hover:text-slate-300">
              Help
            </Link>
            <a href="/privacy" className="hover:text-slate-300">
              Privacy Policy
            </a>
            <a href="/terms" className="hover:text-slate-300">
              Terms of Service
            </a>
            <a href="/refund-policy" className="hover:text-slate-300">
              Refund Policy
            </a>
          </div>
        </div>
      </footer>

      <EngineLeadBot variant="floating" />
    </div>
  );
}
