'use client';

import { useState, useMemo, useEffect } from 'react';
import { toast } from 'sonner';
import {
  Search,
  MapPin,
  BedDouble,
  Bath,
  Maximize2,
  Building,
  Phone,
  MessageCircle,
  X,
  ChevronLeft,
  ChevronRight,
  Filter,
  ArrowUpDown,
  FileText,
  Calendar,
  Send,
  CheckCircle,
  Share2,
} from 'lucide-react';
import type { Property, ShowcaseSettings } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

interface ShowcaseViewProps {
  properties: Property[];
  settings: ShowcaseSettings | null;
  accountId: string;
  referrerContactId?: string;
  referrerPhone?: string;
  initialPropertyId?: string;
}

export function ShowcaseView({ 
  properties, 
  settings, 
  accountId, 
  referrerContactId,
  referrerPhone,
  initialPropertyId 
}: ShowcaseViewProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedType, setSelectedType] = useState('All');
  const [minBeds, setMinBeds] = useState('All');
  const [sortBy, setSortBy] = useState('newest');
  const [selectedProperty, setSelectedProperty] = useState<Property | null>(null);
  const [activeImageIdx, setActiveImageIdx] = useState(0);

  // Form states
  const [inquiryName, setInquiryName] = useState('');
  const [inquiryPhone, setInquiryPhone] = useState('');
  const [inquiryEmail, setInquiryEmail] = useState('');
  const [inquiryMessage, setInquiryMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState(false);

  // Fallback defaults if settings don't exist yet
  const siteName = settings?.website_name || 'Aryavarta Ventures';
  const displayPhone = referrerPhone || settings?.contact_phone || '';
  
  // Format WhatsApp Link targeting the referrer agent phone or settings default
  const targetPhone = displayPhone.replace(/\D/g, '') || '919876543210';

  const getWhatsAppLink = (property: Property) => {
    const defaultTemplate = settings?.whatsapp_message_template || 'Hi! I am interested in your property "{title}" in {location}. Please share details.';
    
    let message = defaultTemplate
      .replace('{title}', property.title)
      .replace('{location}', property.location);

    if (property.property_code) {
      if (message.includes('{property_code}')) {
        message = message.replace('{property_code}', property.property_code);
      } else {
        message += ` (Property ID: ${property.property_code})`;
      }
    } else {
      message = message.replace('({property_code})', '').replace('{property_code}', '');
    }

    return `https://wa.me/${targetPhone}?text=${encodeURIComponent(message)}`;
  };

  // Check if selected property is land/plot type
  const isSelectedPropertyLand = useMemo(() => {
    if (!selectedProperty) return false;
    return [
      'Residential Land/ Plot',
      'Commercial Land',
      'Industrial Land',
      'Agricultural Land'
    ].includes(selectedProperty.type);
  }, [selectedProperty]);

  // Check if selected property has technical specifications to show
  const hasSpecs = useMemo(() => {
    if (!selectedProperty) return false;
    return !!(
      selectedProperty.project ||
      (isSelectedPropertyLand ? selectedProperty.land_area : selectedProperty.area_sqft) ||
      selectedProperty.facing_direction ||
      selectedProperty.dimensions ||
      selectedProperty.land_zone ||
      selectedProperty.road_width
    );
  }, [selectedProperty, isSelectedPropertyLand]);

  // Get distinct property types
  const propertyTypes = useMemo(() => {
    const types = new Set<string>();
    properties.forEach((p) => {
      if (p.type) types.add(p.type);
    });
    return ['All', ...Array.from(types)];
  }, [properties]);

  // Format price helper
  const formatPrice = (amount: number) => {
    const currency = settings?.currency || 'INR';
    if (currency === 'INR') {
      if (amount >= 10000000) {
        const cr = amount / 10000000;
        return `₹${cr.toFixed(2).replace(/\.00$/, '')} Cr`;
      } else if (amount >= 100000) {
        const lakhs = amount / 100000;
        return `₹${lakhs.toFixed(2).replace(/\.00$/, '')} Lakhs`;
      }
      return new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
        maximumFractionDigits: 0,
      }).format(amount);
    }
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  // Filter & Sort properties
  const filteredProperties = useMemo(() => {
    let result = [...properties];

    // Filter by type
    if (selectedType !== 'All') {
      result = result.filter((p) => p.type === selectedType);
    }

    // Filter by beds
    if (minBeds !== 'All') {
      const beds = parseInt(minBeds, 10);
      result = result.filter((p) => p.bedrooms && p.bedrooms >= beds);
    }

    // Filter by search query
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (p) =>
          p.title.toLowerCase().includes(q) ||
          p.location.toLowerCase().includes(q) ||
          (p.project && p.project.toLowerCase().includes(q))
      );
    }

    // Sort
    if (sortBy === 'price-low') {
      result.sort((a, b) => a.price - b.price);
    } else if (sortBy === 'price-high') {
      result.sort((a, b) => b.price - a.price);
    } else if (sortBy === 'area-high') {
      result.sort((a, b) => (b.area_sqft || 0) - (a.area_sqft || 0));
    } else {
      // newest
      result.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    }

    return result;
  }, [properties, selectedType, minBeds, searchQuery, sortBy]);

  // Form submission handler
  const handleInquirySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inquiryName.trim() || !inquiryPhone.trim() || !selectedProperty) return;

    setSubmitting(true);
    try {
      const res = await fetch('/api/public/inquiry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: inquiryName.trim(),
          phone: inquiryPhone.trim(),
          email: inquiryEmail.trim() || undefined,
          message: inquiryMessage.trim() || undefined,
          propertyId: selectedProperty.id,
          propertyTitle: selectedProperty.title,
          propertyCode: selectedProperty.property_code,
          accountId,
          referrerContactId,
        }),
      });

      if (!res.ok) {
        throw new Error('Inquiry submission failed');
      }

      setSubmitSuccess(true);
      toast.success('Your inquiry has been submitted successfully!');
      
      // Clear inputs
      setInquiryName('');
      setInquiryPhone('');
      setInquiryEmail('');
      setInquiryMessage('');
    } catch (err) {
      console.error(err);
      toast.error('Failed to submit inquiry. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  // Deep-linking mount logic
  useEffect(() => {
    if (initialPropertyId) {
      const match = properties.find(
        (p) => p.id === initialPropertyId || (p.property_code && p.property_code.toLowerCase() === initialPropertyId.toLowerCase())
      );
      if (match) {
        setSelectedProperty(match);
        setActiveImageIdx(0);
        setSubmitSuccess(false);
      }
    }
  }, [initialPropertyId, properties]);

  const openPropertyModal = (property: Property) => {
    setSelectedProperty(property);
    setActiveImageIdx(0);
    setSubmitSuccess(false);

    // Sync URL property_id parameter
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.set('property_id', property.property_code || property.id);
      window.history.pushState({}, '', url.toString());
    }
  };

  const closePropertyModal = () => {
    setSelectedProperty(null);

    // Sync URL property_id parameter (remove it)
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.delete('property_id');
      window.history.pushState({}, '', url.toString());
    }
  };

  const getPropertyShareUrl = (property: Property) => {
    if (typeof window === 'undefined') return '';
    const url = new URL(window.location.origin + window.location.pathname);
    url.searchParams.set('property_id', property.property_code || property.id);
    
    // Preserve ref/agent_id parameter if active
    const currentUrl = new URL(window.location.href);
    const refParam = currentUrl.searchParams.get('ref') || currentUrl.searchParams.get('account_id') || currentUrl.searchParams.get('agent_id');
    if (refParam) {
      url.searchParams.set('ref', refParam);
    }
    return url.toString();
  };


  const handleShareListing = async (property: Property, e: React.MouseEvent) => {
    e.stopPropagation();
    const url = getPropertyShareUrl(property);
    if (!url) return;

    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({
          title: property.title,
          text: `Check out this property: ${property.title}${property.property_code ? ` (ID: ${property.property_code})` : ''}`,
          url: url,
        });
        return;
      } catch (err) {
        if (err instanceof Error && err.name !== 'AbortError') {
          console.error('Share failed:', err);
        }
      }
    }

    navigator.clipboard.writeText(url);
    toast.success('Property link copied to clipboard!');
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-primary selection:text-white">
      {/* Decorative Radial Background Lights */}
      <div className="absolute top-0 left-1/4 w-[500px] h-[500px] bg-primary/5 rounded-full blur-[100px] pointer-events-none" />
      <div className="absolute top-1/3 right-1/4 w-[400px] h-[400px] bg-indigo-500/5 rounded-full blur-[80px] pointer-events-none" />

      {/* Header */}
      <header className="sticky top-0 z-30 w-full border-b border-slate-900 bg-slate-950/80 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center font-black text-white text-lg tracking-tighter">
              A
            </div>
            <span className="text-lg font-bold bg-gradient-to-r from-white via-slate-200 to-primary bg-clip-text text-transparent">
              {siteName}
            </span>
          </div>

          <div className="flex items-center gap-4">
            {displayPhone && (
              <a
                href={`tel:${displayPhone.replace(/\s+/g, '')}`}
                className="hidden md:flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors"
              >
                <Phone className="size-3.5 text-primary" />
                {displayPhone}
              </a>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.location.href = '/dashboard'}
              className="border-slate-800 bg-slate-900/50 hover:bg-slate-800 text-slate-200 text-xs font-semibold px-4 cursor-pointer"
            >
              Portal Login
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-10 z-10">
        
        {/* Hero Section */}
        <div className="text-center max-w-3xl mx-auto mb-12 animate-fade-in">
          <h1 className="text-4xl sm:text-5xl font-black text-white tracking-tight leading-tight">
            Discover Your Dream{' '}
            <span className="bg-gradient-to-r from-primary via-indigo-400 to-indigo-500 bg-clip-text text-transparent">
              Inventory & Properties
            </span>
          </h1>
          <p className="mt-4 text-base text-slate-400 font-medium">
            Browse through our handpicked collection of premium villa plots, residential land, apartments, and commercial spaces. Handled directly by agents in our custom CRM.
          </p>
        </div>

        {/* Filter Controls Bar */}
        <div className="bg-slate-900/40 border border-slate-900 rounded-2xl p-5 mb-8 backdrop-blur-md shadow-xl flex flex-col gap-4">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            
            {/* Search Input */}
            <div className="relative lg:col-span-5">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-slate-500" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search location, title, or project..."
                className="pl-10 bg-slate-950 border-slate-800 text-white placeholder:text-slate-650 focus:border-primary focus:ring-1 focus:ring-primary w-full"
              />
            </div>

            {/* Bedroom Filter */}
            <div className="relative lg:col-span-3 flex items-center gap-2">
              <Filter className="size-4 text-slate-500 shrink-0" />
              <select
                value={minBeds}
                onChange={(e) => setMinBeds(e.target.value)}
                className="bg-slate-950 border border-slate-800 rounded-lg text-slate-350 text-sm p-2 w-full focus:outline-none focus:border-primary"
              >
                <option value="All">All Bedrooms</option>
                <option value="1">1+ BHK</option>
                <option value="2">2+ BHK</option>
                <option value="3">3+ BHK</option>
                <option value="4">4+ BHK</option>
              </select>
            </div>

            {/* Sort Control */}
            <div className="relative lg:col-span-4 flex items-center gap-2">
              <ArrowUpDown className="size-4 text-slate-500 shrink-0" />
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="bg-slate-950 border border-slate-800 rounded-lg text-slate-350 text-sm p-2 w-full focus:outline-none focus:border-primary"
              >
                <option value="newest">Newest Listed</option>
                <option value="price-low">Price: Low to High</option>
                <option value="price-high">Price: High to Low</option>
                <option value="area-high">Area: Largest First</option>
              </select>
            </div>
          </div>

          {/* Type Pills */}
          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-900/60 overflow-x-auto scrollbar-none">
            <span className="text-xs text-slate-500 font-bold uppercase tracking-wider mr-2">Category:</span>
            {propertyTypes.map((type) => (
              <button
                key={type}
                onClick={() => setSelectedType(type)}
                className={`text-xs px-3 py-1.5 rounded-full border transition-all cursor-pointer font-semibold ${
                  selectedType === type
                    ? 'bg-primary text-primary-foreground border-primary font-bold shadow-md shadow-primary/20'
                    : 'bg-slate-950 border-slate-850 text-slate-400 hover:text-white hover:border-slate-700'
                }`}
              >
                {type}
              </button>
            ))}
          </div>
        </div>

        {/* Listings Result Grid */}
        {filteredProperties.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-center py-20 border border-dashed border-slate-900 rounded-3xl bg-slate-900/10">
            <Building className="size-16 text-slate-750 opacity-40 mb-3 animate-pulse" />
            <h3 className="text-lg font-bold text-white mb-1">No matching properties found</h3>
            <p className="text-slate-400 max-w-sm text-sm">
              We couldn&apos;t find any published properties matching your criteria. Try adjusting filters or search phrase.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 animate-fade-in-up">
            {filteredProperties.map((property) => {
              const hasImages = property.images && property.images.length > 0;
              const mainImage = hasImages ? property.images[0] : null;
              const isLand = [
                'Residential Land/ Plot',
                'Commercial Land',
                'Industrial Land',
                'Agricultural Land',
                'Land'
              ].includes(property.type);

              return (
                <div
                  key={property.id}
                  className="flex flex-col rounded-2xl border border-slate-900 bg-slate-900/30 overflow-hidden hover:border-slate-800 hover:shadow-2xl hover:shadow-primary/5 transition-all duration-500 group relative"
                >
                  {/* Image Container */}
                  <div 
                    onClick={() => openPropertyModal(property)}
                    className="relative h-52 w-full bg-slate-950 overflow-hidden cursor-pointer shrink-0"
                  >
                    {mainImage ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={mainImage}
                        alt={property.title}
                        className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                      />
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center text-slate-600 gap-2 bg-slate-950">
                        <Building className="size-12 opacity-30" />
                        <span className="text-[11px] font-semibold text-slate-500">No Photos Available</span>
                      </div>
                    )}

                    {/* Overlay Category Tag */}
                    <div className="absolute top-3 left-3 bg-slate-950/80 backdrop-blur-md px-2.5 py-0.5 rounded-full border border-slate-800/80 text-[10px] font-extrabold tracking-wider uppercase text-primary">
                      {property.type}
                    </div>
                  </div>

                  {/* Body Content */}
                  <div className="flex-1 p-5 flex flex-col justify-between">
                    <div>
                      <div className="flex items-center justify-between mb-1 gap-2">
                        <span className="text-[10px] text-slate-500 font-bold uppercase tracking-widest truncate">
                          {property.project ? `🏢 ${property.project}` : ''}
                        </span>
                        {property.property_code && (
                          <span className="text-[9px] font-mono font-bold text-slate-400 bg-slate-950/40 px-1.5 py-0.5 rounded shrink-0">
                            {property.property_code}
                          </span>
                        )}
                      </div>
                      <h3
                        onClick={() => openPropertyModal(property)}
                        className="text-base font-bold text-white line-clamp-1 group-hover:text-primary transition-colors cursor-pointer"
                        title={property.title}
                      >
                        {property.title}
                      </h3>
                      <div className="flex items-center text-xs text-slate-400 gap-1 mt-1 mb-3">
                        <MapPin className="size-3.5 shrink-0 text-slate-650" />
                        <span className="truncate">
                          {property.sublocality && property.city
                            ? `${property.sublocality}, ${property.city}`
                            : property.city || property.sublocality || "Location shared on inquiry"}
                        </span>
                      </div>

                      {/* Specs Grid */}
                      <div className="grid grid-cols-3 gap-2 py-3 border-y border-slate-900/60 text-xs text-slate-350 mb-4 font-semibold">
                        {['Flat/ Apartment', 'Residential House', 'Villa', 'Builder Floor Apartment', 'Penthouse', 'Studio Apartment', 'Farm House', 'House'].includes(property.type) ? (
                          <>
                            <div className="flex flex-col items-center justify-center bg-slate-950/20 py-1 rounded border border-slate-900/20">
                              <BedDouble className="size-3.5 text-slate-500 mb-0.5" />
                              <span>{property.bedrooms ? `${property.bedrooms} BHK` : '--'}</span>
                            </div>
                            <div className="flex flex-col items-center justify-center bg-slate-950/20 py-1 rounded border border-slate-900/20 border-x">
                              <Bath className="size-3.5 text-slate-500 mb-0.5" />
                              <span>{property.bathrooms ? `${property.bathrooms} Bath` : '--'}</span>
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="flex flex-col items-center justify-center bg-slate-950/20 py-1 rounded border border-slate-900/20 col-span-2">
                              <span className="text-[10px] text-slate-500">Zoning</span>
                              <span className="truncate max-w-full text-slate-300">{property.land_zone || 'Residential'}</span>
                            </div>
                          </>
                        )}
                        <div className="flex flex-col items-center justify-center bg-slate-950/20 py-1 rounded border border-slate-900/20">
                          <Maximize2 className="size-3.5 text-slate-500 mb-0.5" />
                          <span className="truncate max-w-full">
                            {isLand
                              ? property.land_area
                                ? `${property.land_area} ${property.land_area_unit || 'Sq.Ft.'}`
                                : '--'
                              : property.area_sqft
                                ? `${property.area_sqft} ${property.area_unit || 'Sq.Ft.'}`
                                : '--'}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div>
                      {/* Price & Primary CTA */}
                      <div className="flex items-center justify-between mt-2 pt-2 gap-2">
                        <div className="flex flex-col">
                          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Price</span>
                          <span className="text-lg font-black text-white leading-tight">
                            {formatPrice(property.price)}
                          </span>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          {displayPhone && (
                            <a
                              href={getWhatsAppLink(property)}
                              target="_blank"
                              rel="noreferrer"
                              className="h-9 w-9 rounded-lg bg-green-600 hover:bg-green-500 text-white flex items-center justify-center hover:scale-105 transition-all shadow-md shadow-green-950/40 cursor-pointer"
                              title="Inquire via WhatsApp"
                            >
                              <MessageCircle className="size-4.5 fill-white text-green-650" />
                            </a>
                          )}
                          <Button
                            size="icon"
                            onClick={(e) => handleShareListing(property, e)}
                            className="h-9 w-9 rounded-lg bg-slate-900 border border-slate-800 hover:bg-slate-850 text-slate-300 hover:text-white flex items-center justify-center hover:scale-105 transition-all shadow-md cursor-pointer"
                            title="Share Listing"
                          >
                            <Share2 className="size-4" />
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => openPropertyModal(property)}
                            className="bg-slate-900 border border-slate-800 hover:bg-slate-850 text-white text-xs font-semibold cursor-pointer"
                          >
                            Details
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="w-full border-t border-slate-900 py-6 mt-16 bg-slate-950">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-xs text-slate-500">
            © 2026 {siteName}. Powered by waCRM. All rights reserved.
          </p>
          <div className="flex items-center gap-4 text-xs text-slate-500">
            {displayPhone && <span>Inquire: {displayPhone}</span>}
            <span className="text-slate-700">|</span>
            <a href="/login" className="hover:text-primary transition-colors hover:underline">
              Agent Portal
            </a>
          </div>
        </div>
      </footer>

      {/* Property Detail Modal */}
      {selectedProperty && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md overflow-y-auto">
          <div className="relative max-w-4xl w-full bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl flex flex-col lg:flex-row my-8 animate-zoom-in max-h-[90vh]">
            
            {/* Close Button */}
            <button
              onClick={closePropertyModal}
              className="absolute top-3 right-3 z-10 p-1.5 rounded-full bg-slate-950/80 text-slate-400 hover:text-white border border-slate-800/80 cursor-pointer"
            >
              <X className="size-4" />
            </button>

            {/* Left Pane: Gallery */}
            <div className="w-full lg:w-[50%] h-[300px] lg:h-auto bg-slate-950 relative flex flex-col min-h-[300px]">
              {selectedProperty.images && selectedProperty.images.length > 0 ? (
                <>
                  {/* Main Viewer */}
                  <div className="flex-1 w-full h-full relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={selectedProperty.images[activeImageIdx]}
                      alt={selectedProperty.title}
                      className="w-full h-full object-cover"
                    />
                    
                    {/* Slider Navigation */}
                    {selectedProperty.images.length > 1 && (
                      <>
                        <button
                          onClick={() => setActiveImageIdx((prev) => (prev > 0 ? prev - 1 : selectedProperty.images.length - 1))}
                          className="absolute left-2 top-1/2 -translate-y-1/2 p-1 rounded-full bg-slate-950/60 text-slate-350 hover:text-white border border-slate-800/40 cursor-pointer"
                        >
                          <ChevronLeft className="size-4" />
                        </button>
                        <button
                          onClick={() => setActiveImageIdx((prev) => (prev < selectedProperty.images.length - 1 ? prev + 1 : 0))}
                          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-full bg-slate-950/60 text-slate-350 hover:text-white border border-slate-800/40 cursor-pointer"
                        >
                          <ChevronRight className="size-4" />
                        </button>
                      </>
                    )}
                  </div>

                  {/* Thumbnail Row */}
                  {selectedProperty.images.length > 1 && (
                    <div className="h-16 border-t border-slate-850 p-2 flex gap-1.5 bg-slate-950/80 overflow-x-auto">
                      {selectedProperty.images.map((imgUrl, i) => (
                        <button
                          key={imgUrl}
                          onClick={() => setActiveImageIdx(i)}
                          className={`h-12 w-16 rounded overflow-hidden shrink-0 border-2 transition-all cursor-pointer ${
                            activeImageIdx === i ? 'border-primary' : 'border-transparent opacity-60 hover:opacity-100'
                          }`}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={imgUrl} alt="" className="w-full h-full object-cover" />
                        </button>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center text-slate-650 gap-2 bg-slate-950 flex-1">
                  <Building className="size-16 opacity-30" />
                  <span className="text-xs font-semibold text-slate-500">No Photos Available</span>
                </div>
              )}
            </div>

            {/* Right Pane: Details & Form */}
            <div className="w-full lg:w-[50%] p-6 flex flex-col justify-between overflow-y-auto max-h-none lg:max-h-[90vh]">
              
              {/* Header Info */}
              <div className="space-y-4">
                <div>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <div className="flex items-center gap-1.5 text-xs text-primary font-extrabold uppercase tracking-widest">
                      <Building className="size-3.5" />
                      {selectedProperty.type}
                    </div>
                    {selectedProperty.property_code && (
                      <span className="text-[10px] font-mono font-bold text-slate-400 bg-slate-900 border border-slate-800 px-2 py-0.5 rounded select-all">
                        {selectedProperty.property_code}
                      </span>
                    )}
                  </div>
                  <h2 className="text-xl font-bold text-white leading-tight">
                    {selectedProperty.title}
                  </h2>
                  <div className="flex items-center text-xs text-slate-400 gap-1 mt-1">
                    <MapPin className="size-3.5 text-slate-500" />
                    <span>
                      {selectedProperty.sublocality && selectedProperty.city
                        ? `${selectedProperty.sublocality}, ${selectedProperty.city}`
                        : selectedProperty.city || selectedProperty.sublocality || "Location shared on inquiry"}
                    </span>
                  </div>
                </div>

                {/* Price Box */}
                <div className="bg-slate-950/40 border border-slate-850 p-4 rounded-xl flex items-center justify-between">
                  <div className="flex flex-col">
                    <span className="text-[10px] text-slate-550 font-bold uppercase tracking-wider">Price</span>
                    <span className="text-2xl font-black text-white leading-tight">
                      {formatPrice(selectedProperty.price)}
                    </span>
                  </div>
                </div>

                {/* Masked Exact Location Block */}
                <div className="bg-slate-950/50 border border-slate-850 p-3.5 rounded-xl space-y-1.5 backdrop-blur-sm relative overflow-hidden group">
                  <div className="absolute inset-0 bg-gradient-to-r from-primary/5 via-transparent to-transparent pointer-events-none" />
                  <div className="flex items-start gap-2.5">
                    <div className="h-7 w-7 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center shrink-0">
                      <MapPin className="size-4 text-amber-500" />
                    </div>
                    <div>
                      <h5 className="text-[11px] font-extrabold text-amber-500 uppercase tracking-wider">Exact Address Masked</h5>
                      <p className="text-[11px] text-slate-400 leading-relaxed mt-0.5">
                        Street address & Google Maps pin link are hidden for privacy. They will be sent directly to your WhatsApp number upon inquiry approval.
                      </p>
                    </div>
                  </div>
                  <div className="filter blur-[2px] opacity-25 select-none text-[10px] pl-9 text-slate-400 font-mono">
                    Exact coordinates: 12.9348° N, 77.6189° E. Map pin: https://maps.google.com/?q=...
                  </div>
                </div>

                {/* Grid Technical Specifications */}
                {hasSpecs && (
                  <div>
                    <h4 className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-2">Specifications</h4>
                    <div className="grid grid-cols-2 gap-3 text-xs">
                      {selectedProperty.project && (
                        <div className="bg-slate-950/20 p-2.5 rounded border border-slate-850/40">
                          <span className="text-slate-500 block text-[9px] uppercase font-bold">Project Name</span>
                          <span className="text-slate-200 font-semibold">{selectedProperty.project}</span>
                        </div>
                      )}

                      {isSelectedPropertyLand ? (
                        selectedProperty.land_area && (
                          <div className="bg-slate-950/20 p-2.5 rounded border border-slate-850/40">
                            <span className="text-slate-500 block text-[9px] uppercase font-bold">Land Area</span>
                            <span className="text-slate-200 font-semibold">
                              {selectedProperty.land_area.toLocaleString('en-IN')} {selectedProperty.land_area_unit || 'Sq.Ft.'}
                            </span>
                          </div>
                        )
                      ) : (
                        selectedProperty.area_sqft && (
                          <div className="bg-slate-950/20 p-2.5 rounded border border-slate-850/40">
                            <span className="text-slate-500 block text-[9px] uppercase font-bold">Total Area</span>
                            <span className="text-slate-200 font-semibold">
                              {selectedProperty.area_sqft.toLocaleString('en-IN')} {selectedProperty.area_unit || 'Sq.Ft.'}
                            </span>
                          </div>
                        )
                      )}

                      {selectedProperty.facing_direction && (
                        <div className="bg-slate-950/20 p-2.5 rounded border border-slate-850/40">
                          <span className="text-slate-500 block text-[9px] uppercase font-bold">Facing Direction</span>
                          <span className="text-slate-200 font-semibold">{selectedProperty.facing_direction}</span>
                        </div>
                      )}

                      {selectedProperty.dimensions && (
                        <div className="bg-slate-950/20 p-2.5 rounded border border-slate-850/40">
                          <span className="text-slate-500 block text-[9px] uppercase font-bold">Dimensions</span>
                          <span className="text-slate-200 font-semibold">{selectedProperty.dimensions}</span>
                        </div>
                      )}

                      {selectedProperty.land_zone && (
                        <div className="bg-slate-950/20 p-2.5 rounded border border-slate-850/40">
                          <span className="text-slate-500 block text-[9px] uppercase font-bold">Land Zone / Zoning</span>
                          <span className="text-slate-200 font-semibold">{selectedProperty.land_zone}</span>
                        </div>
                      )}

                      {selectedProperty.road_width && (
                        <div className="bg-slate-950/20 p-2.5 rounded border border-slate-850/40">
                          <span className="text-slate-500 block text-[9px] uppercase font-bold">Road Width</span>
                          <span className="text-slate-200 font-semibold">
                            {selectedProperty.road_width} {selectedProperty.road_width_unit || 'Ft.'}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Description */}
                {selectedProperty.description && (
                  <div>
                    <h4 className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-1 flex items-center gap-1">
                      <FileText className="size-3.5 text-slate-650" />
                      About Property
                    </h4>
                    <p className="text-slate-350 text-xs leading-relaxed whitespace-pre-line bg-slate-950/10 p-3 border border-slate-900 rounded-xl">
                      {selectedProperty.description}
                    </p>
                  </div>
                )}

                {/* Nearby Highlights */}
                {selectedProperty.nearby_highlights && selectedProperty.nearby_highlights.length > 0 && (
                  <div>
                    <h4 className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-1 flex items-center gap-1">
                      <Calendar className="size-3.5 text-slate-650" />
                      Landmarks & Highlights
                    </h4>
                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                      {selectedProperty.nearby_highlights.map((hl) => (
                        <span
                          key={hl}
                          className="bg-slate-900 border border-slate-850 text-slate-300 text-[10px] font-semibold px-2 py-0.5 rounded"
                        >
                          📍 {hl}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Inquiry Form Block */}
              <div className="mt-6 pt-6 border-t border-slate-850">
                {submitSuccess ? (
                  <div className="bg-green-500/10 border border-green-500/30 p-4 rounded-xl text-center space-y-2 animate-zoom-in">
                    <CheckCircle className="size-10 text-green-400 mx-auto" />
                    <h4 className="text-sm font-bold text-white">Inquiry Submitted</h4>
                    <p className="text-xs text-slate-350 leading-relaxed">
                      Thank you for your interest! An agent has been assigned to review your inquiry and will reach out to you shortly.
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setSubmitSuccess(false)}
                      className="border-slate-800 text-xs mt-2 text-slate-200"
                    >
                      Send another message
                    </Button>
                  </div>
                ) : (
                  <form onSubmit={handleInquirySubmit} className="space-y-3">
                    <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                      Send Instant Inquiry
                    </h4>
                    
                    <div className="grid grid-cols-2 gap-3">
                      <Input
                        required
                        value={inquiryName}
                        onChange={(e) => setInquiryName(e.target.value)}
                        placeholder="Your Name"
                        className="bg-slate-950 border-slate-850 text-white placeholder:text-slate-600 focus:border-primary text-xs"
                      />
                      <Input
                        required
                        type="tel"
                        value={inquiryPhone}
                        onChange={(e) => setInquiryPhone(e.target.value)}
                        placeholder="Mobile Number"
                        className="bg-slate-950 border-slate-850 text-white placeholder:text-slate-600 focus:border-primary text-xs"
                      />
                    </div>

                    <Input
                      type="email"
                      value={inquiryEmail}
                      onChange={(e) => setInquiryEmail(e.target.value)}
                      placeholder="Email Address (Optional)"
                      className="bg-slate-950 border-slate-850 text-white placeholder:text-slate-600 focus:border-primary text-xs w-full"
                    />

                    <Textarea
                      value={inquiryMessage}
                      onChange={(e) => setInquiryMessage(e.target.value)}
                      placeholder={`I am interested in "${selectedProperty.title}". Please share details.`}
                      rows={2}
                      className="bg-slate-950 border-slate-850 text-white placeholder:text-slate-650 focus:border-primary text-xs w-full min-h-[50px]"
                    />

                    <Button
                      type="submit"
                      disabled={submitting}
                      className="w-full bg-primary hover:bg-primary-hover text-primary-foreground text-xs font-bold py-2 rounded-lg flex items-center justify-center gap-1.5 cursor-pointer shadow-md shadow-primary/20"
                    >
                      {submitting ? (
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
                      ) : (
                        <Send className="size-3.5" />
                      )}
                      Submit Lead Form
                    </Button>
                  </form>
                )}
              </div>

            </div>
          </div>
        </div>
      )}
    </div>
  );
}
