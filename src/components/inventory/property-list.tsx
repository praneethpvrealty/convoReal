'use client';

import { useState, ElementType } from 'react';
import type { Property } from '@/types';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  MapPin,
  BedDouble,
  Bath,
  Maximize2,
  Eye,
  EyeOff,
  Edit,
  Trash2,
  Building,
  Home as HomeIcon,
  Loader2,
  Sparkles,
  Share2,
} from 'lucide-react';

const highlightIcons: Record<string, string> = {
  'School': '🏫',
  'Hospital': '🏥',
  'Metro Station': '🚇',
  'Mall': '🛍️',
  'Airport': '✈️',
  'Highway': '🛣️',
  'Railway Station': '🚉',
  'Bus Stop': '🚏',
  'Park': '🌳',
  'Supermarket': '🛒',
};

interface PropertyListProps {
  properties: Property[];
  loading: boolean;
  onEdit: (property: Property) => void;
  onDelete: (property: Property) => void;
  onTogglePublish: (property: Property) => Promise<void>;
  canEdit: boolean;
  onFlyer?: (property: Property) => void;
  onShare?: (property: Property) => void;
  onApprove?: (property: Property) => Promise<void>;
  onReject?: (property: Property) => Promise<void>;
  currency?: string;
}

export function PropertyList({
  properties,
  loading,
  onEdit,
  onDelete,
  onTogglePublish,
  canEdit,
  onFlyer,
  onShare,
  onApprove,
  onReject,
  currency = 'INR',
}: PropertyListProps) {
  const [decidingId, setDecidingId] = useState<string | null>(null);

  async function handleApprove(property: Property) {
    if (!onApprove) return;
    setDecidingId(property.id);
    try {
      await onApprove(property);
    } finally {
      setDecidingId(null);
    }
  }

  async function handleReject(property: Property) {
    if (!onReject) return;
    setDecidingId(property.id);
    try {
      await onReject(property);
    } finally {
      setDecidingId(null);
    }
  }
  const [togglingId, setTogglingId] = useState<string | null>(null);

  // Format currency helper (Lakhs and Crores standard for real estate)
  function formatPrice(amount: number) {
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
  }

  const statusColors: Record<string, string> = {
    Available: 'bg-green-500/10 text-green-400 border-green-500/30',
    'Under Contract': 'bg-amber-500/10 text-amber-400 border-amber-500/30',
    Sold: 'bg-slate-800 text-slate-400 border-slate-700',
    'Off Market': 'bg-red-500/10 text-red-400 border-red-500/30',
    'Pending Review': 'bg-purple-500/10 text-purple-400 border-purple-500/30',
    Rejected: 'bg-red-500/10 text-red-400 border-red-500/30',
  };

  function getTypeIcon(propType: string): ElementType {
    const lowerType = propType.toLowerCase();
    if (lowerType.includes('apartment') || lowerType.includes('flat') || lowerType.includes('penthouse') || lowerType.includes('studio') || lowerType.includes('floor')) {
      return Building;
    }
    if (lowerType.includes('house') || lowerType.includes('villa')) {
      return HomeIcon;
    }
    if (lowerType.includes('land') || lowerType.includes('plot') || lowerType.includes('agricultural')) {
      return MapPin;
    }
    return Building;
  }

  async function handleTogglePublish(property: Property) {
    setTogglingId(property.id);
    try {
      await onTogglePublish(property);
    } finally {
      setTogglingId(null);
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-slate-400">
        <Loader2 className="size-8 animate-spin text-primary mb-4" />
        <p className="text-sm">Loading property inventory...</p>
      </div>
    );
  }

  if (properties.length === 0) {
    return (
      <div className="text-center py-16 border border-dashed border-slate-800 rounded-xl bg-slate-900/40">
        <Building className="size-12 mx-auto text-slate-600 mb-4" />
        <h3 className="text-lg font-semibold text-white mb-1">No listings found</h3>
        <p className="text-sm text-slate-400 max-w-sm mx-auto">
          Create property records or adjust search filters to view inventory.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {properties.map((property) => {
        const TypeIcon = getTypeIcon(property.type);
        const hasImages = property.images && property.images.length > 0;
        const mainImage = hasImages ? property.images[0] : null;
        const isLand = [
          'Residential Land/ Plot',
          'Commercial Land',
          'Industrial Land',
          'Agricultural Land'
        ].includes(property.type);

        return (
          <div
            key={property.id}
            className="flex flex-col rounded-xl border border-slate-800 bg-slate-900 overflow-hidden hover:border-slate-700 hover:shadow-md transition-all duration-300 group"
          >
            {/* Card Thumbnail */}
            <div className="relative h-48 w-full bg-slate-950 overflow-hidden shrink-0">
              {mainImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={mainImage}
                  alt={property.title}
                  className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                  onError={(e) => {
                    // Fallback on load error
                    (e.target as HTMLImageElement).src = '';
                  }}
                />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center text-slate-600 gap-2">
                  <Building className="size-10 opacity-40" />
                  <span className="text-xs">No photos uploaded</span>
                </div>
              )}

              {/* Status Badge */}
              <div className="absolute top-3 left-3 flex flex-wrap gap-1.5 max-w-[calc(100%-4rem)]">
                <Badge
                  className={`border font-semibold text-[10px] tracking-wider uppercase px-2 py-0.5 rounded-full ${
                    property.listing_type === 'Rent'
                      ? 'bg-blue-500/20 text-blue-400 border-blue-500/30'
                      : 'bg-primary/20 text-primary border-primary/30'
                  }`}
                >
                  {property.listing_type === 'Rent' ? 'For Rent' : 'For Sale'}
                </Badge>
                <Badge
                  className={
                    property.status === 'Sold'
                      ? 'bg-red-600 text-white border-red-500 font-black text-xs tracking-wider uppercase px-2.5 py-0.5 rounded-full shadow-md shadow-red-950/50 animate-pulse scale-105 border'
                      : `border font-semibold text-[10px] tracking-wider uppercase px-2 py-0.5 rounded-full ${
                          statusColors[property.status] || 'bg-slate-800 text-slate-300 border-slate-700'
                        }`
                  }
                >
                  {property.status}
                </Badge>
                {property.listing_source === 'agent' && (
                  <Badge
                    className="bg-sky-500/90 text-white border-sky-600 font-semibold text-[10px] tracking-wider uppercase px-2 py-0.5 rounded-full"
                  >
                    Agent Referred
                  </Badge>
                )}
                {property.listing_source === 'whatsapp_lister' && (
                  <Badge
                    className="bg-emerald-600/90 text-white border-emerald-700 font-semibold text-[10px] tracking-wider uppercase px-2 py-0.5 rounded-full"
                  >
                    Submitted via WhatsApp
                  </Badge>
                )}
              </div>

              {/* Publication Status Overlay */}
              <div className="absolute top-3 right-3">
                <button
                  type="button"
                  disabled={!canEdit || togglingId === property.id}
                  onClick={() => handleTogglePublish(property)}
                  className={`flex items-center justify-center p-2 rounded-full backdrop-blur-md transition-all ${
                    property.is_published
                      ? 'bg-primary/95 text-primary-foreground hover:bg-primary'
                      : 'bg-slate-950/80 text-slate-400 hover:text-white'
                  } border border-slate-800/60 disabled:opacity-50`}
                  title={property.is_published ? 'Showcased Publicly — Click to Hide' : 'Private Listing — Click to Showcase'}
                >
                  {togglingId === property.id ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : property.is_published ? (
                    <Eye className="size-3.5" />
                  ) : (
                    <EyeOff className="size-3.5" />
                  )}
                </button>
              </div>
            </div>

            {/* Content Body */}
            <div className="flex-1 p-5 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between gap-2 mb-1">
                  <div className="flex items-center gap-1.5 text-xs text-primary font-semibold uppercase tracking-wider">
                    <TypeIcon className="size-3.5" />
                    {property.type}
                  </div>
                  {property.property_code && (
                    <span className="text-[10px] font-mono font-bold text-slate-400 bg-slate-950/40 px-1.5 py-0.5 rounded select-all" title="Copy Property Code">
                      {property.property_code}
                    </span>
                  )}
                </div>
                {property.project && (
                  <div className="text-xs text-slate-300 font-semibold mb-1 truncate flex items-center gap-1" title={property.project}>
                    <span>🏢</span> <span className="truncate">{property.project}</span>
                  </div>
                )}
                <h4 className="text-base font-bold text-white line-clamp-1 mb-1 group-hover:text-primary transition-colors" title={property.title}>
                  {property.title}
                </h4>
                <div className="flex items-center text-xs text-slate-400 gap-1 mb-3">
                  <MapPin className="size-3.5 shrink-0 text-slate-500" />
                  <span className="truncate" title={property.location}>{property.location}</span>
                  {property.location_tier === 'exact' && (
                    <span className="shrink-0 text-[9px] font-bold uppercase tracking-wide text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 rounded-full">
                      In area
                    </span>
                  )}
                  {property.location_tier === 'nearby' && property.distance_km !== null && property.distance_km !== undefined && (
                    <span className="shrink-0 text-[9px] font-bold text-sky-400 bg-sky-500/10 border border-sky-500/20 px-1.5 py-0.5 rounded-full">
                      {property.distance_km} km away
                    </span>
                  )}
                </div>

                <div className="flex items-center justify-between mb-4">
                  <div className="text-lg font-black text-white">
                    {property.listing_type === 'Rent' ? (
                      <span className="flex flex-col">
                        <span>{formatPrice(property.rent_per_month || 0)}/mo</span>
                        {property.maintenance && property.maintenance > 0 ? (
                          <span className="text-[10px] text-slate-400 font-medium">+ {formatPrice(property.maintenance)} Maint.</span>
                        ) : null}
                      </span>
                    ) : (
                      formatPrice(property.price)
                    )}
                  </div>
                  {property.owner && (
                    <div className="text-xs text-slate-400 flex items-center gap-1 bg-slate-800/40 px-2 py-0.5 rounded border border-slate-800" title={`${property.owner.name} (${property.owner.phone})`}>
                      <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">
                        {property.owner.classification || 'Owner'}:
                      </span>
                      <span className="text-slate-350 font-semibold">{property.owner.name || 'Unnamed'}</span>
                    </div>
                  )}
                </div>

                {/* Specs Row */}
                <div className="grid grid-cols-3 gap-2 py-3 border-y border-slate-800 text-xs text-slate-300 font-medium mb-4">
                  {['Flat/ Apartment', 'Residential House', 'Villa', 'Builder Floor Apartment', 'Penthouse', 'Studio Apartment', 'Farm House'].includes(property.type) ? (
                    <>
                      <div className="flex items-center gap-1.5 justify-center">
                        <BedDouble className="size-4 text-slate-500" />
                        <span>{property.bedrooms !== null && property.bedrooms !== undefined ? `${property.bedrooms} Beds` : '--'}</span>
                      </div>
                      <div className="flex items-center gap-1.5 justify-center border-x border-slate-800">
                        <Bath className="size-4 text-slate-500" />
                        <span>{property.bathrooms !== null && property.bathrooms !== undefined ? `${property.bathrooms} Baths` : '--'}</span>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="flex items-center gap-1.5 justify-center">
                        <Building className="size-4 text-slate-500" />
                        <span className="truncate" title={property.type}>{property.type.split('/')[0].split(' ')[0]}</span>
                      </div>
                      <div className="flex items-center gap-1.5 justify-center border-x border-slate-800">
                        <MapPin className="size-4 text-slate-500" />
                        <span className="truncate" title={property.sublocality || '--'}>{property.sublocality || '--'}</span>
                      </div>
                    </>
                  )}
                  <div className="flex items-center gap-1.5 justify-center">
                    <Maximize2 className="size-3.5 text-slate-500" />
                    <span>
                      {isLand
                        ? property.land_area
                          ? `${property.land_area.toLocaleString('en-IN')} ${property.land_area_unit || 'Sq.Ft.'}`
                          : '--'
                        : property.area_sqft
                          ? `${property.area_sqft.toLocaleString('en-IN')} ${property.area_unit || 'Sq.Ft.'}`
                          : '--'}
                    </span>
                  </div>
                </div>

                {/* Extended Specs & Commercial Details */}
                {(property.super_built_area || (!isLand && property.land_area) || (isLand && property.area_sqft) || property.land_zone || property.ideal_for || property.dimensions || property.road_width || property.facing_direction || property.rental_income) ? (
                  <div className="flex flex-col gap-1.5 text-[11px] text-slate-400 font-medium px-1 mb-4">
                    {/* Areas */}
                    {(property.super_built_area || (!isLand && property.land_area) || (isLand && property.area_sqft)) && (
                      <div className="flex justify-between flex-wrap gap-y-2">
                        {property.super_built_area ? (
                          <div>
                            Super Built: <span className="text-slate-200">{property.super_built_area.toLocaleString('en-IN')} Sq.Ft.</span>
                          </div>
                        ) : null}
                        {!isLand && property.land_area ? (
                          <div>
                            Land Area: <span className="text-slate-200">{property.land_area.toLocaleString('en-IN')} {property.land_area_unit || 'Sq.Ft.'}</span>
                          </div>
                        ) : null}
                        {isLand && property.area_sqft ? (
                          <div>
                            Built-up Area: <span className="text-slate-200">{property.area_sqft.toLocaleString('en-IN')} {property.area_unit || 'Sq.Ft.'}</span>
                          </div>
                        ) : null}
                      </div>
                    )}
                    {/* Dimensions & Zone/Ideal */}
                    {(property.dimensions || property.land_zone || property.ideal_for) && (
                      <div className="flex justify-between flex-wrap gap-y-2 border-t border-slate-800/45 pt-1.5">
                        {property.dimensions ? (
                          <div>
                            Dimensions: <span className="text-slate-200">{property.dimensions}</span>
                          </div>
                        ) : (
                          property.land_zone ? (
                            <div>
                              Zone: <span className="text-slate-200">{property.land_zone}</span>
                            </div>
                          ) : null
                        )}
                        {property.ideal_for ? (
                          <div className="max-w-[150px] truncate" title={property.ideal_for}>
                            Ideal for: <span className="text-slate-200">{property.ideal_for}</span>
                          </div>
                        ) : null}
                      </div>
                    )}
                    {/* Road and Direction Details */}
                    {(property.road_width || property.facing_direction || (property.dimensions && property.land_zone)) && (
                      <div className="flex justify-between flex-wrap gap-y-2 border-t border-slate-800/45 pt-1.5">
                        {property.road_width ? (
                          <div>
                            Road Width: <span className="text-slate-200">{property.road_width} {property.road_width_unit || 'Feet'}</span>
                          </div>
                        ) : (
                          property.dimensions && property.land_zone ? (
                            <div>
                              Zone: <span className="text-slate-200">{property.land_zone}</span>
                            </div>
                          ) : null
                        )}
                        {property.facing_direction ? (
                          <div>
                            Facing: <span className="text-slate-200">{property.facing_direction}</span>
                          </div>
                        ) : null}
                      </div>
                    )}
                    {/* Rental Income & ROI details */}
                    {property.rental_income ? (
                      <div className="flex justify-between flex-wrap gap-y-2 border-t border-slate-800/45 pt-1.5">
                        <div>
                          Monthly Rent: <span className="text-slate-200">{formatPrice(property.rental_income)}/month</span>
                        </div>
                        {property.roi ? (
                          <div>
                            ROI (Yield): <span className="text-primary font-semibold">{property.roi}%</span>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                    {/* Rental details for Rent listings */}
                    {property.listing_type === 'Rent' && (property.advance || property.gst) ? (
                      <div className="flex justify-between flex-wrap gap-y-2 border-t border-slate-800/45 pt-1.5 text-[10px]">
                        {property.advance ? (
                          <div>
                            Deposit: <span className="text-slate-200">{formatPrice(property.advance)}</span>
                          </div>
                        ) : null}
                        {property.gst ? (
                          <div>
                            GST: <span className="text-slate-200">{formatPrice(property.gst)}</span>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {/* Features Badges */}
                {property.features && property.features.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-4">
                    {property.features.slice(0, 3).map((feature, i) => (
                      <Badge
                        key={i}
                        variant="outline"
                        className="bg-slate-950/40 border-slate-800 text-[10px] text-slate-400 font-normal px-2 py-0.5 rounded"
                      >
                        {feature}
                      </Badge>
                    ))}
                    {property.features.length > 3 && (
                      <Badge
                        variant="outline"
                        className="bg-slate-950/40 border-slate-800 text-[10px] text-slate-500 font-normal px-1.5 py-0.5 rounded"
                      >
                        +{property.features.length - 3} more
                      </Badge>
                    )}
                  </div>
                )}

                {/* Nearby Highlights */}
                {property.nearby_highlights && property.nearby_highlights.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-4 border-t border-slate-800/40 pt-3">
                    <span className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider w-full mb-1 block">Nearby Landmarks</span>
                    {property.nearby_highlights.slice(0, 4).map((highlight, i) => (
                      <Badge
                        key={i}
                        variant="outline"
                        className="bg-slate-950/20 border-slate-800/80 text-[10px] text-slate-300 font-normal px-2 py-0.5 rounded-full flex items-center gap-1"
                      >
                        <span>{highlightIcons[highlight] || '📍'}</span>
                        <span>{highlight}</span>
                      </Badge>
                    ))}
                    {property.nearby_highlights.length > 4 && (
                      <Badge
                        variant="outline"
                        className="bg-slate-950/20 border-slate-800/80 text-[10px] text-slate-500 font-normal px-1.5 py-0.5 rounded-full"
                      >
                        +{property.nearby_highlights.length - 4} more
                      </Badge>
                    )}
                  </div>
                )}

                {/* Interested Contacts / Leads */}
                {property.interested_contacts && property.interested_contacts.length > 0 && (
                  <div className="mt-4 pt-3 border-t border-slate-800/40">
                    <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider block mb-1.5">
                      Interested Leads ({property.interested_contacts.length})
                    </span>
                    <div className="grid grid-cols-1 gap-1.5">
                      {property.interested_contacts.map((contact) => (
                        <div
                          key={contact.id}
                          className="flex items-center justify-between text-xs bg-slate-950/20 px-2.5 py-1 rounded border border-slate-800/40 hover:border-slate-800 transition-all"
                        >
                          <span className="font-semibold text-slate-200 truncate max-w-[120px]" title={contact.name}>
                            👤 {contact.name || 'Unnamed'}
                          </span>
                          <div className="flex items-center gap-1.5 font-semibold">
                            <span className="text-slate-450 font-mono text-[10px]">{contact.phone}</span>
                            <span className="text-[9px] bg-slate-950/50 text-slate-400 border border-slate-800/40 px-1 rounded">
                              {contact.classification}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div className="flex justify-end gap-2 pt-2 border-t border-slate-800/60 mt-auto flex-wrap">
                {canEdit && property.status === 'Pending Review' && onApprove && (
                  <Button
                    type="button"
                    size="sm"
                    disabled={decidingId === property.id}
                    onClick={() => handleApprove(property)}
                    className="h-8 bg-green-600 hover:bg-green-700 text-white font-medium"
                  >
                    {decidingId === property.id && <Loader2 className="size-3.5 animate-spin mr-1.5" />}
                    Approve
                  </Button>
                )}
                {canEdit && property.status === 'Pending Review' && onReject && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={decidingId === property.id}
                    onClick={() => handleReject(property)}
                    className="h-8 border-red-900/50 hover:bg-red-950/20 hover:text-red-400 text-red-400"
                  >
                    Reject
                  </Button>
                )}
                {onFlyer && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => onFlyer(property)}
                    className="h-8 border-slate-800 hover:bg-slate-800 hover:text-white text-slate-300"
                  >
                    <Sparkles className="size-3.5 mr-1.5 text-primary" /> Flyer
                  </Button>
                )}
                {onShare && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => onShare(property)}
                    className="h-8 border-slate-800 hover:bg-slate-800 hover:text-white text-slate-300"
                  >
                    <Share2 className="size-3.5 mr-1.5 text-primary" /> Share
                  </Button>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => onEdit(property)}
                  className="h-8 border-slate-800 hover:bg-slate-800 hover:text-white text-slate-300"
                >
                  <Edit className="size-3.5 mr-1.5" /> Details
                </Button>
                {canEdit && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => onDelete(property)}
                    className="h-8 border-slate-850 hover:bg-red-950/20 hover:text-red-400 hover:border-red-900/50 text-slate-400"
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
