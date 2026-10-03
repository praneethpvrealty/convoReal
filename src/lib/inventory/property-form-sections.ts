export interface PropertyFormSectionInput {
  title: string;
  price: string;
  rentPerMonth: string;
  city: string;
  state: string;
  images: string[];
  description: string;
  ownerContactId: string | null;
}

export interface PropertyFormSection {
  id: string;
  label: string;
  done: boolean | null;
}

export function propertyFormSections(
  input: PropertyFormSectionInput
): PropertyFormSection[] {
  return [
    {
      id: 'pf-basics',
      label: 'Basics',
      done:
        input.title.trim() !== '' &&
        (input.price.trim() !== '' || input.rentPerMonth.trim() !== ''),
    },
    {
      id: 'pf-location',
      label: 'Location',
      done: input.city.trim() !== '' && input.state.trim() !== '',
    },
    { id: 'pf-specs', label: 'Area & specs', done: null },
    {
      id: 'pf-media',
      label: 'Photos & documents',
      done: input.images.some((url) => url.trim() !== ''),
    },
    {
      id: 'pf-description',
      label: 'Description',
      done: input.description.trim() !== '',
    },
    {
      id: 'pf-owner',
      label: 'Owner & inquiries',
      done: input.ownerContactId !== null,
    },
    { id: 'pf-publish', label: 'Publish', done: null },
  ];
}
