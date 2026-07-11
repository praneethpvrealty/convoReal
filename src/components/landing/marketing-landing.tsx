'use client';

import { useState, useRef, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
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
  ShoppingCart
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MARKETING_CONFIG } from '@/config/marketing';
import { CrmLeadForm } from '@/components/landing/crm-lead-form';
import { BRANDING } from '@/config/branding';

export function MarketingLanding() {
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        window.location.href = '/dashboard';
      }
    });
  }, []);

  // Demo states
  const [demoStep, setDemoStep] = useState<'idle' | 'parsing' | 'completed'>('idle');
  const [copyStep, setCopyStep] = useState<'idle' | 'writing' | 'completed'>('idle');
  const [matchStep, setMatchStep] = useState<'idle' | 'matching' | 'completed'>('idle');
  const [showcaseStep, setShowcaseStep] = useState<'idle' | 'loading' | 'completed'>('idle');
  const [faqOpen, setFaqOpen] = useState<Record<number, boolean>>({});

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
        left: direction === 'left' ? scrollLeft - scrollAmount : scrollLeft + scrollAmount,
        behavior: 'smooth'
      });
    }
  };

  const toggleFaq = (idx: number) => {
    setFaqOpen(prev => ({
      ...prev,
      [idx]: !prev[idx]
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
      default:
        return <Sparkles className="size-5" />;
    }
  };

  const isRealEstate = MARKETING_CONFIG.vertical === 'real_estate';

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-indigo-500 selection:text-white overflow-x-hidden relative">
      {/* Decorative Radial Background Lights */}
      <div className="absolute top-0 left-1/4 w-[600px] h-[600px] bg-indigo-500/10 rounded-full blur-[140px] pointer-events-none" />
      <div className="absolute top-1/3 right-1/4 w-[500px] h-[500px] bg-violet-500/5 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute top-2/3 left-1/3 w-[600px] h-[600px] bg-emerald-500/5 rounded-full blur-[140px] pointer-events-none" />

      {/* Header */}
      <header className="sticky top-0 z-50 w-full border-b border-slate-900 bg-slate-950/80 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-500 flex items-center justify-center font-black text-white text-xl tracking-tighter shadow-lg shadow-indigo-500/25">
              C
            </div>
            <span className="text-xl font-bold bg-gradient-to-r from-white via-slate-200 to-indigo-400 bg-clip-text text-transparent tracking-tight">
              ConvoReal
            </span>
          </div>

          <nav className="hidden md:flex items-center gap-8 text-sm font-semibold text-slate-300">
            <a href="#features" className="hover:text-white transition-colors">Features</a>
            <a href="#demo" className="hover:text-white transition-colors">Interactive Demo</a>
            <a href="#pricing" className="hover:text-white transition-colors">Pricing</a>
            <a href="#faq" className="hover:text-white transition-colors">FAQ</a>
            <a href="#get-started" className="hover:text-white transition-colors">Talk to us</a>
          </nav>

          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              onClick={() => window.location.href = '/login'}
              className="text-slate-300 hover:text-white hover:bg-slate-900/60 text-xs font-semibold px-4 cursor-pointer"
            >
              Sign In
            </Button>
            <Button
              onClick={() => window.location.href = '/signup'}
              className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold px-4 py-2 rounded-xl shadow-lg shadow-indigo-600/20 hover:shadow-indigo-600/30 hover:scale-[1.02] transition-all cursor-pointer"
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
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center relative z-10">
            {/* Tagline Badge */}
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-indigo-500/30 bg-indigo-500/10 text-indigo-300 text-xs font-bold mb-6 animate-fade-in tracking-wide">
              <Sparkles className="size-3.5" />
              {MARKETING_CONFIG.hero.badge}
            </div>

            {/* Main Headline */}
            <h1 className="text-4xl sm:text-6xl font-black text-white tracking-tight leading-none max-w-4xl mx-auto mb-6">
              {MARKETING_CONFIG.hero.headlineStart}
              <span className="bg-gradient-to-r from-indigo-400 via-violet-400 to-emerald-400 bg-clip-text text-transparent">
                {MARKETING_CONFIG.hero.headlineHighlight}
              </span>
              {MARKETING_CONFIG.hero.headlineEnd}
            </h1>

            {/* Sub-headline */}
            <p className="max-w-2xl mx-auto text-base sm:text-lg text-slate-400 font-medium mb-10 leading-relaxed">
              {MARKETING_CONFIG.hero.subheadline}
            </p>

            {/* CTAs */}
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-20">
              <Button
                onClick={() => window.location.href = '/signup'}
                className="w-full sm:w-auto bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white text-sm font-bold px-8 py-6 rounded-xl hover:scale-103 transition-all shadow-xl shadow-indigo-600/25 cursor-pointer flex items-center justify-center gap-2"
              >
                {MARKETING_CONFIG.hero.ctaPrimary}
                <ArrowRight className="size-4" />
              </Button>
              <a
                href="#demo"
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-8 py-3.5 rounded-xl border border-slate-800 bg-slate-900/40 text-slate-200 text-sm font-semibold hover:bg-slate-800 hover:text-white hover:scale-102 transition-all"
              >
                <Play className="size-4 text-indigo-400" />
                {MARKETING_CONFIG.hero.ctaSecondary}
              </a>
            </div>

            {/* Dashboard Mockup */}
            <div className="relative mx-auto max-w-5xl rounded-2xl border border-slate-800/80 bg-slate-900/30 p-2 sm:p-4 backdrop-blur-md shadow-2xl shadow-slate-950/80 group">
              <div className="absolute -inset-0.5 bg-gradient-to-r from-indigo-500 to-violet-500 rounded-2xl opacity-10 blur-xl group-hover:opacity-15 transition-opacity" />
              <div className="relative rounded-xl border border-slate-950 overflow-hidden bg-slate-950 flex flex-col aspect-[16/9]">
                {/* Header Mockup */}
                <div className="h-10 bg-slate-900/80 border-b border-slate-800/50 px-4 flex items-center justify-between shrink-0">
                  <div className="flex items-center gap-1.5">
                    <div className="size-3 rounded-full bg-rose-500/80" />
                    <div className="size-3 rounded-full bg-amber-500/80" />
                    <div className="size-3 rounded-full bg-emerald-500/80" />
                  </div>
                  <span className="text-[10px] text-slate-500 font-mono tracking-widest">https://app.convoreal.com/dashboard</span>
                  <div className="w-12" />
                </div>
                {/* Dashboard layout simulator */}
                <div className="flex-1 flex overflow-hidden text-left text-xs text-slate-400">
                  {/* Left Sidebar */}
                  <div className="w-36 bg-slate-950 border-r border-slate-900/50 p-2 flex flex-col gap-1.5 shrink-0 hidden sm:flex">
                    <div className="h-5 bg-indigo-500/10 text-indigo-300 rounded px-2 py-0.5 font-bold flex items-center gap-1.5">
                      <MessageSquare className="size-3" /> Inbox
                    </div>
                    <div className="h-5 hover:bg-slate-900 rounded px-2 py-0.5 flex items-center gap-1.5">
                      <Users className="size-3" /> {isRealEstate ? 'Contacts' : 'Customers'}
                    </div>
                    <div className="h-5 hover:bg-slate-900 rounded px-2 py-0.5 flex items-center gap-1.5">
                      {isRealEstate ? <Building className="size-3" /> : <ShoppingCart className="size-3" />} 
                      {isRealEstate ? 'Inventory' : 'Catalog'}
                    </div>
                    <div className="h-5 hover:bg-slate-900 rounded px-2 py-0.5 flex items-center gap-1.5">
                      <Layers className="size-3" /> Broadcasts
                    </div>
                  </div>
                  
                  {/* Main Work Area Mock */}
                  <div className="flex-1 bg-slate-900/20 p-3 overflow-hidden flex flex-col gap-3">
                    {/* Header stat boxes */}
                    <div className="grid grid-cols-3 gap-2">
                      <div className="bg-slate-950/80 border border-slate-850 p-2 rounded-lg flex flex-col gap-0.5">
                        <span className="text-[10px] text-slate-500 font-bold uppercase">{isRealEstate ? 'Total Leads' : 'Total Orders'}</span>
                        <span className="text-sm font-black text-white">{isRealEstate ? '412' : '1,284'}</span>
                      </div>
                      <div className="bg-slate-950/80 border border-slate-850 p-2 rounded-lg flex flex-col gap-0.5">
                        <span className="text-[10px] text-slate-500 font-bold uppercase">Active Inquiries</span>
                        <span className="text-sm font-black text-indigo-400">{isRealEstate ? '54' : '142'}</span>
                      </div>
                      <div className="bg-slate-950/80 border border-slate-850 p-2 rounded-lg flex flex-col gap-0.5">
                        <span className="text-[10px] text-slate-500 font-bold uppercase">{isRealEstate ? 'Properties Matched' : 'Cart Recovery'}</span>
                        <span className="text-sm font-black text-emerald-400">{isRealEstate ? '89%' : '42.8%'}</span>
                      </div>
                    </div>

                    {/* Chat simulator & Details panel split */}
                    <div className="flex-1 grid grid-cols-1 md:grid-cols-12 gap-3 min-h-0">
                      {/* Left Inbox Column */}
                      <div className="md:col-span-7 bg-slate-950 border border-slate-900 rounded-lg flex flex-col overflow-hidden min-h-0">
                        <div className="bg-slate-900/60 p-2 border-b border-slate-900 flex justify-between items-center shrink-0">
                          <span className="font-bold text-white flex items-center gap-1.5">
                            <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
                            Rajesh Kumar
                          </span>
                          <span className="text-[10px] text-slate-500">{isRealEstate ? 'JP Nagar, Bangalore' : 'Shopify Store'}</span>
                        </div>
                        <div className="flex-1 p-2 flex flex-col gap-2 overflow-y-auto">
                          <div className="max-w-[85%] bg-slate-900/70 p-2 rounded-lg self-start">
                            <p className="text-[11px] text-slate-300">
                              {isRealEstate 
                                ? 'Looking for a premium 3 BHK apartment or villa plot around JP Nagar. Budget 2-2.5 Cr. Send options.'
                                : 'Looking for a premium leather watch strap in dark brown, size 22mm. Budget is under 2,000 INR. Send options.'
                              }
                            </p>
                            <span className="text-[8px] text-slate-500 block text-right mt-1">11:05 AM</span>
                          </div>
                          <div className="max-w-[85%] bg-indigo-600/25 border border-indigo-500/25 p-2 rounded-lg self-end text-slate-200">
                            <p className="text-[11px]">
                              {isRealEstate
                                ? 'Hi Rajesh, here is a list of handpicked properties matching your budget of ₹2.5 Cr in JP Nagar: convoreal.com/pvrealty?ref=pv'
                                : 'Hi Rajesh, here is our Classic Brown Leather Band matching your 22mm preference for ₹1,800: convoreal.com/shop?ref=store'
                              }
                            </p>
                            <span className="text-[8px] text-indigo-400 block text-right mt-1">11:07 AM · Delivered</span>
                          </div>
                        </div>
                      </div>

                      {/* Right AI Match Suggestions */}
                      <div className="md:col-span-5 bg-slate-950 border border-slate-900 rounded-lg p-2 flex flex-col gap-2 overflow-y-auto min-h-0">
                        <span className="text-[10px] font-bold text-slate-300 uppercase tracking-wider border-b border-slate-900 pb-1 flex items-center gap-1">
                          <Bot className="size-3.5 text-indigo-400" />
                          AI Match suggestions
                        </span>
                        <div className="border border-emerald-500/30 bg-emerald-950/10 p-2 rounded-lg flex flex-col gap-1.5">
                          <div className="flex justify-between items-start">
                            <span className="font-bold text-white text-[11px]">
                              {isRealEstate ? 'JP Nagar Villa Plot' : 'Classic Brown Band'}
                            </span>
                            <span className="bg-emerald-500/10 text-emerald-400 text-[8px] font-bold px-1.5 py-0.5 rounded">98% Match</span>
                          </div>
                          <p className="text-[10px] text-slate-400">
                            {isRealEstate ? '1200 Sq.Ft · ₹2.1 Cr · Owner Direct' : '22mm Italian Calfskin · ₹1,800 · In Stock'}
                          </p>
                          <div className="flex gap-1.5 mt-0.5">
                            <button className="bg-emerald-500 text-slate-950 font-bold px-2 py-0.5 rounded text-[9px] cursor-default">Share via WA</button>
                            <button className="border border-slate-800 hover:bg-slate-900 text-slate-300 px-2 py-0.5 rounded text-[9px] cursor-default">View Details</button>
                          </div>
                        </div>
                        <div className="border border-indigo-500/20 bg-slate-900/30 p-2 rounded-lg flex flex-col gap-1.5 opacity-60">
                          <div className="flex justify-between items-start">
                            <span className="font-bold text-white text-[11px]">
                              {isRealEstate ? 'Sobha Clovelly 3BHK' : 'Vintage Leather Strap'}
                            </span>
                            <span className="bg-indigo-500/10 text-indigo-400 text-[8px] font-bold px-1.5 py-0.5 rounded">82% Match</span>
                          </div>
                          <p className="text-[10px] text-slate-400 font-medium">
                            {isRealEstate ? '2100 Sq.Ft · ₹2.7 Cr · Agent Referred' : '22mm Genuine Leather · ₹1,500 · Out of Stock'}
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
        <section id="features" className="py-20 bg-slate-900/30 border-t border-slate-900">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center max-w-3xl mx-auto mb-16">
              <h2 className="text-3xl sm:text-4xl font-black text-white tracking-tight">
                Supercharge Your Inbound Inquiries
              </h2>
              <p className="mt-4 text-slate-400 text-sm sm:text-base font-medium">
                ConvoReal integrates directly with WhatsApp to capture customers, catalog inventory, and broadcast updates instantly.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              {MARKETING_CONFIG.features.map((feature, idx) => (
                <div 
                  key={idx} 
                  className="bg-slate-950 border border-slate-900 rounded-2xl p-6 hover:border-indigo-500/30 hover:scale-[1.02] transition-all flex flex-col gap-4"
                >
                  <div className="size-10 bg-indigo-500/10 rounded-xl flex items-center justify-center text-indigo-400 shrink-0 animate-pulse">
                    {renderIcon(feature.icon)}
                  </div>
                  <h3 className="text-lg font-bold text-white">{feature.title}</h3>
                  <p className="text-sm text-slate-400 leading-relaxed font-medium">
                    {feature.description}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Interactive Feature Showcases */}
        <section id="demo" className="py-20 relative overflow-hidden">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex flex-col md:flex-row md:items-end justify-between mb-12">
              <div className="max-w-3xl">
                <span className="text-xs font-black uppercase text-indigo-400 tracking-wider">Try it Live</span>
                <h2 className="text-3xl sm:text-4xl font-black text-white mt-2 tracking-tight">
                  See Our Hero Features in Action
                </h2>
                <p className="mt-4 text-slate-400 text-sm sm:text-base font-medium">
                  Interact with real-time simulations of the core engines. Slide through or use the arrows to explore.
                </p>
              </div>
              <div className="flex gap-2 mt-6 md:mt-0">
                <button 
                  onClick={() => scroll('left')}
                  className="p-3 bg-slate-900/80 border border-slate-800 rounded-full text-slate-400 hover:text-white hover:bg-indigo-600 transition-all shadow-xl cursor-pointer"
                  aria-label="Scroll Left"
                >
                  <ChevronLeft className="size-4" />
                </button>
                <button 
                  onClick={() => scroll('right')}
                  className="p-3 bg-slate-900/80 border border-slate-800 rounded-full text-slate-400 hover:text-white hover:bg-indigo-600 transition-all shadow-xl cursor-pointer"
                  aria-label="Scroll Right"
                >
                  <ChevronRight className="size-4" />
                </button>
              </div>
            </div>

            {/* Scroller Container */}
            <div 
              ref={scrollContainerRef}
              className="flex gap-6 overflow-x-auto snap-x snap-mandatory py-4 scroll-smooth"
              style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
            >
              
              {/* CARD 1: AI Chat Ingestion */}
              <div className="w-[88vw] sm:w-[480px] shrink-0 snap-center bg-slate-900/40 border border-slate-800/80 rounded-3xl p-6 relative flex flex-col justify-between h-[450px] shadow-2xl backdrop-blur-sm hover:border-indigo-500/20 transition-all">
                <div className="flex flex-col gap-3.5">
                  <div className="flex items-center gap-3">
                    <div className="size-8 rounded-lg bg-indigo-500/10 flex items-center justify-center text-indigo-400">
                      <MessageSquare className="size-4.5" />
                    </div>
                    <span className="text-xs font-black text-slate-500 uppercase tracking-widest">1. WhatsApp AI Parser</span>
                  </div>
                  <h3 className="text-lg font-bold text-white tracking-tight">Lead Chat Ingestion</h3>
                  
                  {/* Dynamic Inner Panel */}
                  <div className="h-[210px] rounded-xl border border-slate-850 bg-slate-950 p-4 overflow-y-auto leading-relaxed select-none text-[11px]">
                    {demoStep === 'idle' && (
                      <div className="font-mono text-slate-400 space-y-1">
                        <span className="text-slate-500 font-bold block mb-1.5">{"// Messy chat message forwarded to CRM:"}</span>
                        &ldquo;{MARKETING_CONFIG.demo.mockMessage}&rdquo;
                      </div>
                    )}
                    
                    {demoStep === 'parsing' && (
                      <div className="h-full flex flex-col justify-center space-y-3.5 px-2">
                        <div className="h-3.5 bg-slate-900 rounded-full w-2/3 animate-pulse" />
                        <div className="h-2.5 bg-slate-900 rounded-full w-1/2 animate-pulse" />
                        <div className="h-8 bg-slate-900 rounded-lg w-full animate-pulse" />
                        <div className="h-2.5 bg-slate-900 rounded-full w-3/4 animate-pulse" />
                      </div>
                    )}
                    
                    {demoStep === 'completed' && (
                      <div className="space-y-3 animate-fade-in">
                        <div className="flex justify-between items-center border-b border-slate-900 pb-2">
                          <div>
                            <h4 className="font-bold text-white text-xs flex items-center gap-1.5">
                              {MARKETING_CONFIG.demo.parsedCard.name}
                              <span className="size-1.5 rounded-full bg-emerald-500" />
                            </h4>
                            <span className="text-[9px] text-slate-400">{MARKETING_CONFIG.demo.parsedCard.contact}</span>
                          </div>
                          <span className="bg-indigo-500/10 text-indigo-400 text-[8px] font-black px-2 py-0.5 rounded-full border border-indigo-500/20">
                            {MARKETING_CONFIG.demo.parsedCard.badge}
                          </span>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-[9px] text-slate-300">
                          {MARKETING_CONFIG.demo.parsedCard.fields.map((f, i) => (
                            <div key={i}>
                              <span className="text-slate-500 block font-bold uppercase tracking-wide text-[7px]">{f.label}</span>
                              <span className={f.isHighlight ? 'text-emerald-400 font-bold' : ''}>{f.value}</span>
                            </div>
                          ))}
                        </div>
                        <div className="border border-emerald-500/20 bg-emerald-950/10 p-2 rounded-lg flex items-center justify-between text-[8px]">
                          <div>
                            <span className="text-white font-bold block">Auto-Matched Listing</span>
                            <span className="text-slate-400">{MARKETING_CONFIG.demo.parsedCard.matchedItem.title}</span>
                          </div>
                          <span className="bg-emerald-400 text-slate-950 font-black px-1 rounded">{MARKETING_CONFIG.demo.parsedCard.matchedItem.percentage}</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Footer buttons */}
                <div>
                  {demoStep === 'idle' && (
                    <Button onClick={handleSimulateParse} className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2.5 rounded-xl cursor-pointer text-xs flex items-center justify-center gap-1.5">
                      <Bot className="size-3.5" /> Simulate AI Parse Ingestion
                    </Button>
                  )}
                  {demoStep === 'parsing' && (
                    <Button disabled className="w-full bg-slate-800 text-slate-400 font-bold py-2.5 rounded-xl cursor-not-allowed text-xs flex items-center justify-center gap-1.5">
                      <div className="size-3 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" /> Ingesting and matching...
                    </Button>
                  )}
                  {demoStep === 'completed' && (
                    <Button onClick={() => setDemoStep('idle')} className="w-full border border-slate-800 bg-slate-900 hover:bg-slate-800 text-slate-200 font-bold py-2.5 rounded-xl transition-all cursor-pointer text-xs">
                      Reset Simulation
                    </Button>
                  )}
                </div>
              </div>

              {/* CARD 2: Gemini Copywriter */}
              <div className="w-[88vw] sm:w-[480px] shrink-0 snap-center bg-slate-900/40 border border-slate-800/80 rounded-3xl p-6 relative flex flex-col justify-between h-[450px] shadow-2xl backdrop-blur-sm hover:border-indigo-500/20 transition-all">
                <div className="flex flex-col gap-3.5">
                  <div className="flex items-center gap-3">
                    <div className="size-8 rounded-lg bg-violet-500/10 flex items-center justify-center text-violet-400">
                      <Sparkles className="size-4.5" />
                    </div>
                    <span className="text-xs font-black text-slate-500 uppercase tracking-widest">2. Gemini Description Writer</span>
                  </div>
                  <h3 className="text-lg font-bold text-white tracking-tight">AI Copywriting Generator</h3>
                  
                  {/* Dynamic Inner Panel */}
                  <div className="h-[210px] rounded-xl border border-slate-850 bg-slate-950 p-4 overflow-y-auto leading-relaxed select-none text-[11px]">
                    {copyStep === 'idle' && (
                      <div className="space-y-2 text-slate-350">
                        <span className="text-slate-500 font-bold block mb-1.5">{"// Basic specifications captured from agent:"}</span>
                        {isRealEstate ? (
                          <>
                            <div className="flex justify-between border-b border-slate-900 pb-1">
                              <span className="text-slate-500">Property Category</span>
                              <span className="font-semibold text-slate-200">Residential Flat (3 BHK)</span>
                            </div>
                            <div className="flex justify-between border-b border-slate-900 pb-1">
                              <span className="text-slate-500">Location</span>
                              <span className="font-semibold text-slate-200">HSR Layout Sector 3</span>
                            </div>
                            <div className="flex justify-between border-b border-slate-900 pb-1">
                              <span className="text-slate-500">Asking Price</span>
                              <span className="font-semibold text-slate-200">₹2.4 Crores</span>
                            </div>
                            <div className="flex justify-between border-b border-slate-900 pb-1">
                              <span className="text-slate-500">Key Features</span>
                              <span className="font-semibold text-slate-200">Gym, Swimming pool, Metro nearby</span>
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="flex justify-between border-b border-slate-900 pb-1">
                              <span className="text-slate-500">Product Category</span>
                              <span className="font-semibold text-slate-200">Calfskin Watch Strap</span>
                            </div>
                            <div className="flex justify-between border-b border-slate-900 pb-1">
                              <span className="text-slate-500">Size / Color</span>
                              <span className="font-semibold text-slate-200">22mm / Dark Brown</span>
                            </div>
                            <div className="flex justify-between border-b border-slate-900 pb-1">
                              <span className="text-slate-500">Price</span>
                              <span className="font-semibold text-slate-200">₹1,800</span>
                            </div>
                            <div className="flex justify-between border-b border-slate-900 pb-1">
                              <span className="text-slate-500">Stock Availability</span>
                              <span className="font-semibold text-slate-200">15 units left</span>
                            </div>
                          </>
                        )}
                      </div>
                    )}
                    
                    {copyStep === 'writing' && (
                      <div className="h-full flex flex-col justify-center space-y-3.5 px-2">
                        <div className="h-3.5 bg-slate-900 rounded-full w-3/4 animate-pulse" />
                        <div className="h-2.5 bg-slate-900 rounded-full w-5/6 animate-pulse" />
                        <div className="h-2.5 bg-slate-900 rounded-full w-2/3 animate-pulse" />
                        <div className="h-2.5 bg-slate-900 rounded-full w-1/2 animate-pulse" />
                      </div>
                    )}
                    
                    {copyStep === 'completed' && (
                      <div className="space-y-2 animate-fade-in text-slate-300 font-mono text-[10px] whitespace-pre-wrap leading-normal">
                        {isRealEstate ? (
                          `🏡 **LUXURIOUS 3 BHK RESIDENCE IN HSR LAYOUT**

Experience modern luxury at its finest! Nestled in a prime gated community in HSR Layout, this spacious 3 BHK apartment offers the perfect blend of elegance and convenience.

✨ **Key Highlights:**
• 🏊‍♂️ Premium Swimming Pool & Fully Equipped Gym
• 🚇 Unbeatable location — minutes away from the metro
• 🛡️ 24/7 Gated Security & Dedicated Car Parking

*Asking Price: ₹2.4 Crores*
*Direct Owner Listing.*`
                        ) : (
                          `⌚ **CLASSIC DARK BROWN LEATHER STRAP (22mm)**

Upgrade your timepiece with Italian craftsmanship. Made from genuine calfskin leather, this 22mm watch band features detailed hand-stitching and a brushed stainless steel buckle.

✨ **Key Highlights:**
• 🇮🇹 100% Genuine Italian Calfskin
• 📐 Compatibility: Fits any watch with standard 22mm lugs
• 🛡️ Quick-release spring bars for hassle-free swaps

*Retail Price: ₹1,800*
*In Stock — Ships Next Day!*`
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Footer buttons */}
                <div>
                  {copyStep === 'idle' && (
                    <Button onClick={handleSimulateCopy} className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2.5 rounded-xl cursor-pointer text-xs flex items-center justify-center gap-1.5">
                      <Sparkles className="size-3.5" /> Generate AI Copywriting
                    </Button>
                  )}
                  {copyStep === 'writing' && (
                    <Button disabled className="w-full bg-slate-800 text-slate-400 font-bold py-2.5 rounded-xl cursor-not-allowed text-xs flex items-center justify-center gap-1.5">
                      <div className="size-3 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" /> Gemini generating ad copy...
                    </Button>
                  )}
                  {copyStep === 'completed' && (
                    <Button onClick={() => setCopyStep('idle')} className="w-full border border-slate-800 bg-slate-900 hover:bg-slate-800 text-slate-200 font-bold py-2.5 rounded-xl transition-all cursor-pointer text-xs">
                      Reset Simulation
                    </Button>
                  )}
                </div>
              </div>

              {/* CARD 3: Smart Match & ROI Filters */}
              <div className="w-[88vw] sm:w-[480px] shrink-0 snap-center bg-slate-900/40 border border-slate-800/80 rounded-3xl p-6 relative flex flex-col justify-between h-[450px] shadow-2xl backdrop-blur-sm hover:border-indigo-500/20 transition-all">
                <div className="flex flex-col gap-3.5">
                  <div className="flex items-center gap-3">
                    <div className="size-8 rounded-lg bg-amber-500/10 flex items-center justify-center text-amber-400">
                      <Zap className="size-4.5" />
                    </div>
                    <span className="text-xs font-black text-slate-500 uppercase tracking-widest">3. Smart Matching & Yields</span>
                  </div>
                  <h3 className="text-lg font-bold text-white tracking-tight">Criteria Compatibility Engine</h3>
                  
                  {/* Dynamic Inner Panel */}
                  <div className="h-[210px] rounded-xl border border-slate-850 bg-slate-950 p-4 overflow-y-auto leading-relaxed select-none text-[11px]">
                    {matchStep === 'idle' && (
                      <div className="space-y-2 text-slate-350">
                        <span className="text-slate-500 font-bold block mb-1.5">{"// Buyer preferences mapped in CRM:"}</span>
                        <div className="flex justify-between border-b border-slate-900 pb-1">
                          <span className="text-slate-500">Client Profile</span>
                          <span className="font-semibold text-slate-200">Vikram Malhotra (Investor)</span>
                        </div>
                        <div className="flex justify-between border-b border-slate-900 pb-1">
                          <span className="text-slate-500">Max Budget</span>
                          <span className="font-semibold text-slate-200">₹15.0 Crore</span>
                        </div>
                        {isRealEstate ? (
                          <>
                            <div className="flex justify-between border-b border-slate-900 pb-1">
                              <span className="text-slate-500">Preferred Type</span>
                              <span className="font-semibold text-slate-200">Commercial Complex / Building</span>
                            </div>
                            <div className="flex justify-between border-b border-slate-900 pb-1">
                              <span className="text-slate-500">Expected Yield</span>
                              <span className="font-black text-amber-400">Min 5.5% ROI</span>
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="flex justify-between border-b border-slate-900 pb-1">
                              <span className="text-slate-500">Preferred Category</span>
                              <span className="font-semibold text-slate-200">Leather Watch Straps</span>
                            </div>
                            <div className="flex justify-between border-b border-slate-900 pb-1">
                              <span className="text-slate-500">Target Size</span>
                              <span className="font-black text-amber-400">22mm Wide</span>
                            </div>
                          </>
                        )}
                      </div>
                    )}
                    
                    {matchStep === 'matching' && (
                      <div className="h-full flex flex-col justify-center space-y-3.5 px-2">
                        <div className="h-3.5 bg-slate-900 rounded-full w-2/3 animate-pulse" />
                        <div className="h-8 bg-slate-900 rounded-lg w-full animate-pulse" />
                        <div className="h-8 bg-slate-900 rounded-lg w-full animate-pulse" />
                      </div>
                    )}
                    
                    {matchStep === 'completed' && (
                      <div className="space-y-2.5 animate-fade-in text-[10px]">
                        <span className="text-slate-500 font-bold block mb-1">{"// Matched catalog items (Sorted by score):"}</span>
                        
                        {isRealEstate ? (
                          <>
                            <div className="border border-indigo-500/25 bg-indigo-950/10 p-2.5 rounded-xl flex items-center justify-between">
                              <div>
                                <span className="text-white font-bold block text-[11px]">1. Indiranagar Office Block</span>
                                <span className="text-slate-400 text-[9px]">Price: ₹13.8 Cr · ROI: 6.2% Yield · 100ft road</span>
                              </div>
                              <span className="bg-indigo-500 text-white font-black px-1.5 py-0.5 rounded text-[8px]">98% Match</span>
                            </div>
                            <div className="border border-slate-900 bg-slate-950 p-2.5 rounded-xl flex items-center justify-between">
                              <div>
                                <span className="text-slate-200 font-semibold block text-[11px]">2. Koramangala Commercial Hub</span>
                                <span className="text-slate-500 text-[9px]">Price: ₹14.5 Cr · ROI: 5.6% Yield · Sector 4</span>
                              </div>
                              <span className="bg-slate-800 text-slate-400 font-bold px-1.5 py-0.5 rounded text-[8px]">88% Match</span>
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="border border-indigo-500/25 bg-indigo-950/10 p-2.5 rounded-xl flex items-center justify-between">
                              <div>
                                <span className="text-white font-bold block text-[11px]">1. Classic Brown Leather Band</span>
                                <span className="text-slate-400 text-[9px]">Price: ₹1,800 · Size: 22mm · In Stock</span>
                              </div>
                              <span className="bg-indigo-500 text-white font-black px-1.5 py-0.5 rounded text-[8px]">95% Match</span>
                            </div>
                            <div className="border border-slate-900 bg-slate-950 p-2.5 rounded-xl flex items-center justify-between">
                              <div>
                                <span className="text-slate-200 font-semibold block text-[11px]">2. Premium Tan Suede Strap</span>
                                <span className="text-slate-500 text-[9px]">Price: ₹1,950 · Size: 22mm · Low Stock</span>
                              </div>
                              <span className="bg-slate-800 text-slate-400 font-bold px-1.5 py-0.5 rounded text-[8px]">85% Match</span>
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
                    <Button onClick={handleSimulateMatch} className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2.5 rounded-xl cursor-pointer text-xs flex items-center justify-center gap-1.5">
                      <Zap className="size-3.5" /> Find Inventory Matches
                    </Button>
                  )}
                  {matchStep === 'matching' && (
                    <Button disabled className="w-full bg-slate-800 text-slate-400 font-bold py-2.5 rounded-xl cursor-not-allowed text-xs flex items-center justify-center gap-1.5">
                      <div className="size-3 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" /> Querying inventory list...
                    </Button>
                  )}
                  {matchStep === 'completed' && (
                    <Button onClick={() => setMatchStep('idle')} className="w-full border border-slate-800 bg-slate-900 hover:bg-slate-800 text-slate-200 font-bold py-2.5 rounded-xl transition-all cursor-pointer text-xs">
                      Reset Simulation
                    </Button>
                  )}
                </div>
              </div>

              {/* CARD 4: Branded Showcase Portal */}
              <div className="w-[88vw] sm:w-[480px] shrink-0 snap-center bg-slate-900/40 border border-slate-800/80 rounded-3xl p-6 relative flex flex-col justify-between h-[450px] shadow-2xl backdrop-blur-sm hover:border-indigo-500/20 transition-all">
                <div className="flex flex-col gap-3.5">
                  <div className="flex items-center gap-3">
                    <div className="size-8 rounded-lg bg-emerald-500/10 flex items-center justify-center text-emerald-400">
                      <Globe className="size-4.5" />
                    </div>
                    <span className="text-xs font-black text-slate-500 uppercase tracking-widest">4. Branded Showcase Portal</span>
                  </div>
                  <h3 className="text-lg font-bold text-white tracking-tight">Public Catalog Showcase</h3>
                  
                  {/* Dynamic Inner Panel */}
                  <div className="h-[210px] rounded-xl border border-slate-850 bg-slate-950 p-4 overflow-y-auto leading-relaxed select-none text-[11px] flex flex-col justify-center">
                    {showcaseStep === 'idle' && (
                      <div className="space-y-2 text-slate-350">
                        <span className="text-slate-500 font-bold block mb-1.5">{"// Configure custom portal mapping:"}</span>
                        <div className="flex justify-between items-center border-b border-slate-900 pb-1.5">
                          <span className="text-slate-500">Showcase Brand</span>
                          <span className="font-semibold text-slate-200">{isRealEstate ? 'PV Realty' : 'Boutique Watch'}</span>
                        </div>
                        <div className="flex justify-between items-center border-b border-slate-900 pb-1.5">
                          <span className="text-slate-500">Live URL</span>
                          <span className="font-mono text-indigo-400">{isRealEstate ? 'pv-realty.convoreal.com' : 'boutique.convoreal.com'}</span>
                        </div>
                        <div className="flex justify-between items-center border-b border-slate-900 pb-1.5">
                          <span className="text-slate-500">Domain Status</span>
                          <span className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[8px] font-bold px-1.5 rounded-full">SSL Secured</span>
                        </div>
                      </div>
                    )}
                    
                    {showcaseStep === 'loading' && (
                      <div className="h-full flex flex-col justify-center space-y-3.5 px-2">
                        <div className="h-3.5 bg-slate-900 rounded-full w-1/2 animate-pulse" />
                        <div className="h-3.5 bg-slate-900 rounded-full w-2/3 animate-pulse" />
                        <div className="h-3.5 bg-slate-900 rounded-full w-1/3 animate-pulse" />
                      </div>
                    )}
                    
                    {showcaseStep === 'completed' && (
                      <div className="space-y-2 animate-fade-in text-[10px] flex-1 flex flex-col justify-between">
                        {/* Domain bar mock */}
                        <div className="bg-slate-900/60 px-2.5 py-1.5 rounded-lg border border-slate-800 flex justify-between items-center">
                          <div className="flex items-center gap-1.5">
                            <div className="size-3.5 rounded bg-indigo-600 flex items-center justify-center text-white text-[8px] font-extrabold">C</div>
                            <span className="text-white font-extrabold text-[8px]">{isRealEstate ? 'PV Realty' : 'Boutique Watch'} Portal</span>
                          </div>
                          <span className="text-[7px] text-slate-400 font-mono">listings.yourdomain.com</span>
                        </div>
                        
                        {/* Image Showcase Card */}
                        {isRealEstate ? (
                          <div className="bg-slate-950 border border-slate-900 rounded-xl overflow-hidden shadow-lg p-1.5 flex flex-col gap-1.5">
                            <div className="relative h-[95px] w-full rounded-lg overflow-hidden border border-slate-900">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img 
                                src="https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=400&h=200&q=80" 
                                alt="Stunning Modern Villa"
                                className="w-full h-full object-cover"
                              />
                              <span className="absolute top-1.5 right-1.5 bg-indigo-600/90 text-white font-extrabold px-1.5 py-0.5 rounded text-[8px] tracking-wide shadow-md">
                                ₹4.4 Cr
                              </span>
                              <span className="absolute bottom-1.5 left-1.5 bg-emerald-500/90 text-slate-950 font-black px-1.5 py-0.5 rounded text-[7px] tracking-wide">
                                98% Match
                              </span>
                            </div>
                            <div className="px-1 flex flex-col gap-0.5">
                              <div className="flex justify-between items-center">
                                <span className="text-slate-200 font-extrabold text-[10px]">JP Nagar Luxury Villa Plot</span>
                                <span className="text-slate-500 text-[8px]">Direct Owner</span>
                              </div>
                              <span className="text-slate-400 text-[8px] block text-left">Devanahalli · 4200 Sq.Ft · Gated Layout</span>
                            </div>
                            <span className="bg-emerald-500 text-slate-950 font-extrabold py-1.5 rounded-lg flex items-center justify-center gap-1 text-[8px] cursor-default w-full text-center">
                              💬 Inquire on WhatsApp
                            </span>
                          </div>
                        ) : (
                          <div className="bg-slate-950 border border-slate-900 rounded-xl overflow-hidden shadow-lg p-1.5 flex flex-col gap-1.5">
                            <div className="relative h-[95px] w-full rounded-lg overflow-hidden border border-slate-900">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img 
                                src="https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=400&h=200&q=80" 
                                alt="Classic Brown Watch Strap"
                                className="w-full h-full object-cover"
                              />
                              <span className="absolute top-1.5 right-1.5 bg-indigo-600/90 text-white font-extrabold px-1.5 py-0.5 rounded text-[8px] tracking-wide shadow-md">
                                ₹1,800
                              </span>
                              <span className="absolute bottom-1.5 left-1.5 bg-emerald-500/90 text-slate-950 font-black px-1.5 py-0.5 rounded text-[7px] tracking-wide">
                                95% Match
                              </span>
                            </div>
                            <div className="px-1 flex flex-col gap-0.5">
                              <div className="flex justify-between items-center">
                                <span className="text-slate-200 font-extrabold text-[10px]">Classic Italian Leather Strap</span>
                                <span className="text-slate-500 text-[8px]">In Stock</span>
                              </div>
                              <span className="text-slate-400 text-[8px] block text-left">22mm Dark Brown · Genuine Calfskin</span>
                            </div>
                            <span className="bg-emerald-500 text-slate-950 font-extrabold py-1.5 rounded-lg flex items-center justify-center gap-1 text-[8px] cursor-default w-full text-center">
                              💬 Buy on WhatsApp
                            </span>
                          </div>
                        )}
                        <span className="text-slate-500 text-center text-[7px] font-bold block mt-0.5">✓ Syncs with listings in your database instantly.</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Footer buttons */}
                <div>
                  {showcaseStep === 'idle' && (
                    <Button onClick={handleSimulateShowcase} className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2.5 rounded-xl cursor-pointer text-xs flex items-center justify-center gap-1.5">
                      <Globe className="size-3.5" /> Activate Live Showcase
                    </Button>
                  )}
                  {showcaseStep === 'loading' && (
                    <Button disabled className="w-full bg-slate-800 text-slate-400 font-bold py-2.5 rounded-xl cursor-not-allowed text-xs flex items-center justify-center gap-1.5">
                      <div className="size-3 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" /> Provisioning portal CDN dns...
                    </Button>
                  )}
                  {showcaseStep === 'completed' && (
                    <Button onClick={() => setShowcaseStep('idle')} className="w-full border border-slate-800 bg-slate-900 hover:bg-slate-800 text-slate-200 font-bold py-2.5 rounded-xl transition-all cursor-pointer text-xs">
                      Reset Simulation
                    </Button>
                  )}
                </div>
              </div>

            </div>
          </div>
        </section>

        {/* Pricing Plan Cards */}
        <section id="pricing" className="py-20 bg-slate-900/30 border-t border-slate-900">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center max-w-3xl mx-auto mb-16">
              <span className="text-xs font-black uppercase text-indigo-400 tracking-wider">Simple Pricing</span>
              <h2 className="text-3xl sm:text-4xl font-black text-white mt-2 tracking-tight">
                Plans Built for Every Scale
              </h2>
              <p className="mt-4 text-slate-400 text-sm sm:text-base font-medium">
                Choose the pricing plan that fits your business size. Start free, upgrade as you grow.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 max-w-7xl mx-auto">
              {MARKETING_CONFIG.pricing.map((plan, idx) => (
                <div 
                  key={idx} 
                  className={`bg-slate-950 rounded-2xl p-6 flex flex-col gap-6 relative shadow-lg ${
                    plan.isPopular ? 'border-2 border-indigo-600 shadow-2xl shadow-indigo-600/5' : 'border border-slate-900'
                  }`}
                >
                  {plan.isPopular && (
                    <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 bg-indigo-600 text-white text-[10px] font-black uppercase px-3 py-1 rounded-full tracking-wider">
                      Most Popular
                    </div>
                  )}
                  <div>
                    <h3 className="text-lg font-bold text-white">{plan.name}</h3>
                    <p className="text-xs text-slate-500 mt-1">{plan.description}</p>
                  </div>
                  <div className="flex items-baseline gap-1">
                    <span className="text-4xl font-black text-white">{plan.price}</span>
                    <span className="text-xs text-slate-400">/ {plan.period}</span>
                  </div>
                  <Button
                    onClick={() => window.location.href = '/signup'}
                    className={`w-full font-bold py-3.5 rounded-xl transition-all cursor-pointer ${
                      plan.isPopular 
                        ? 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/25'
                        : 'border border-slate-800 bg-slate-900 hover:bg-slate-800 text-slate-200'
                    }`}
                  >
                    {plan.price === '₹0' ? 'Get Started' : 'Start Free Trial'}
                  </Button>
                  <ul className="space-y-3.5 text-xs text-slate-350 border-t border-slate-900 pt-6">
                    {plan.features.map((feat, fidx) => (
                      <li key={fidx} className="flex items-center gap-2">
                        <Check className="size-4 text-indigo-400 shrink-0" />
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
        <section id="get-started" className="py-20 bg-slate-900/30 border-t border-slate-900">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-10">
              <span className="text-xs font-black uppercase text-indigo-400 tracking-wider">Get Started</span>
              <h2 className="text-3xl sm:text-4xl font-black text-white mt-2 tracking-tight">
                See {BRANDING.name} on your listings
              </h2>
              <p className="text-slate-400 mt-3 max-w-xl mx-auto">
                Tell us a bit about your business and we&apos;ll get you set up on WhatsApp — no credit card, no software to install.
              </p>
            </div>
            <CrmLeadForm />
          </div>
        </section>

        {/* FAQ Section */}
        <section id="faq" className="py-20 relative max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <span className="text-xs font-black uppercase text-indigo-400 tracking-wider">Got Questions?</span>
            <h2 className="text-3xl sm:text-4xl font-black text-white mt-2 tracking-tight">
              Frequently Asked Questions
            </h2>
          </div>

          <div className="space-y-4">
            {MARKETING_CONFIG.faqs.map((faq, idx) => (
              <div 
                key={idx} 
                className="bg-slate-900/40 border border-slate-900 rounded-xl overflow-hidden transition-colors"
              >
                <button
                  onClick={() => toggleFaq(idx)}
                  className="w-full px-5 py-4 flex items-center justify-between text-left font-bold text-white hover:text-indigo-400 transition-colors text-sm sm:text-base cursor-pointer"
                >
                  <span>{faq.q}</span>
                  <ChevronDown className={`size-4 text-slate-400 shrink-0 transition-transform duration-255 ${faqOpen[idx] ? 'rotate-180 text-indigo-400' : ''}`} />
                </button>
                <div 
                  className={`transition-all duration-255 overflow-hidden ${
                    faqOpen[idx] ? 'max-h-60 border-t border-slate-900/60' : 'max-h-0'
                  }`}
                >
                  <p className="px-5 py-4 text-xs sm:text-sm text-slate-400 leading-relaxed font-medium">
                    {faq.a}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Bottom CTA Banner */}
        <section className="py-20 relative">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <div className="relative overflow-hidden bg-gradient-to-r from-slate-900 to-indigo-950/40 border border-slate-800 rounded-3xl p-8 sm:p-12 shadow-2xl">
              <div className="absolute -top-20 -right-20 w-80 h-80 bg-indigo-500/10 rounded-full blur-[80px]" />
              <div className="absolute -bottom-20 -left-20 w-60 h-60 bg-emerald-500/10 rounded-full blur-[80px]" />
              
              <div className="relative z-10 space-y-6">
                <h2 className="text-3xl sm:text-4xl font-black text-white tracking-tight">
                  Supercharge Your Inbound Pipeline
                </h2>
                <p className="max-w-xl mx-auto text-slate-400 text-sm leading-relaxed font-medium">
                  Connect your WhatsApp business account and start importing contacts and listings within 5 minutes. No credit card required.
                </p>
                <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
                  <Button
                    onClick={() => window.location.href = '/signup'}
                    className="w-full sm:w-auto bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold px-8 py-5 rounded-xl hover:scale-102 transition-all shadow-lg shadow-indigo-600/20 cursor-pointer"
                  >
                    Create Free Account
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => window.location.href = '/login'}
                    className="w-full sm:w-auto border-slate-850 bg-slate-950 hover:bg-slate-900 text-slate-200 text-xs font-semibold px-8 py-5 rounded-xl cursor-pointer"
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
      <footer className="border-t border-slate-900 bg-slate-950 py-10 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-6 text-xs text-slate-500">
          <div className="flex items-center gap-2">
            <div className="h-6 w-6 rounded-md bg-indigo-600 flex items-center justify-center font-black text-white text-xs tracking-tighter">
              C
            </div>
            <span className="font-bold text-slate-350">ConvoReal</span>
          </div>
          <p className="font-medium">
            &copy; {new Date().getFullYear()} ConvoReal CRM (waCRM). All rights reserved.
          </p>
          <div className="flex items-center gap-6 font-semibold">
            <a href="/privacy" className="hover:text-slate-300">Privacy Policy</a>
            <a href="/terms" className="hover:text-slate-300">Terms of Service</a>
            <a href="/refund-policy" className="hover:text-slate-300">Refund Policy</a>
          </div>
        </div>
      </footer>

    </div>
  );
}
