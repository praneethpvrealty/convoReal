export interface PlanMediaCopy {
  heading: string;
  itemLabel: string;
  addAction: string;
  nameLabel: string;
  namePlaceholder: string;
  notesPlaceholder: string;
  emptyText: string;
  uploadLabel: string;
}

const FLOOR_COPY: PlanMediaCopy = {
  heading: 'Floor Plans',
  itemLabel: 'Floor',
  addAction: 'Add Floor',
  nameLabel: 'Floor',
  namePlaceholder: 'e.g. Ground Floor',
  notesPlaceholder: 'e.g. 3 BHK + pooja room',
  emptyText: 'No floor plans yet.',
  uploadLabel: 'Plan',
};

const LAND_COPY: PlanMediaCopy = {
  heading: 'Land Sketches',
  itemLabel: 'Sketch',
  addAction: 'Add Sketch',
  nameLabel: 'Sketch name',
  namePlaceholder: 'Survey sketch / Tippan / Layout plan',
  notesPlaceholder: 'e.g. Boundaries, road access or survey details',
  emptyText: 'No land sketches yet.',
  uploadLabel: 'Sketch',
};

export function planMediaCopy(isLand: boolean): PlanMediaCopy {
  return isLand ? LAND_COPY : FLOOR_COPY;
}
