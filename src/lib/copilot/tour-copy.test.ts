import { describe, expect, it } from 'vitest';
import { TOURS } from './tours';
import {
  TOUR_COPY,
  localizeMobileTour,
  localizeTour,
  tourCopyFor,
} from './tour-copy';

describe('tour copy [CPL-007]', () => {
  it('translates every tour in every listed language, step for step', () => {
    for (const [language, tours] of Object.entries(TOUR_COPY)) {
      for (const tour of TOURS) {
        const copy = tours[tour.id];
        expect(copy, `${language}/${tour.id} has no translation`).toBeDefined();
        expect(copy!.title, `${language}/${tour.id}`).toBeTruthy();
        expect(copy!.description, `${language}/${tour.id}`).toBeTruthy();
        expect(copy!.steps.length, `${language}/${tour.id} steps`).toBe(
          tour.steps.length
        );
        for (const [i, step] of copy!.steps.entries()) {
          expect(step.title, `${language}/${tour.id}[${i}]`).toBeTruthy();
          expect(step.body, `${language}/${tour.id}[${i}]`).toBeTruthy();
        }
        if (tour.mobileSteps?.length) {
          expect(
            copy!.mobileSteps?.length,
            `${language}/${tour.id} mobileSteps`
          ).toBe(tour.mobileSteps.length);
        } else {
          expect(copy!.mobileSteps, `${language}/${tour.id}`).toBeUndefined();
        }
      }
      for (const id of Object.keys(tours)) {
        expect(
          TOURS.some((t) => t.id === id),
          `${language}/${id}`
        ).toBe(true);
      }
    }
  });

  it('keeps the bold markers that name buttons', () => {
    for (const tours of Object.values(TOUR_COPY)) {
      for (const [id, copy] of Object.entries(tours)) {
        for (const [i, step] of copy.steps.entries()) {
          const marks = step.body.split('**').length - 1;
          expect(marks % 2, `${id}[${i}] unbalanced **`).toBe(0);
        }
      }
    }
  });

  it('localizes a tour and falls back to English where untranslated', () => {
    const tour = TOURS.find((t) => t.id === 'add-contact')!;
    const hi = localizeTour(tour, 'hi');
    expect(hi.id).toBe('add-contact');
    expect(hi.title).toBe(tourCopyFor('add-contact', 'hi')!.title);
    expect(hi.steps).toHaveLength(tour.steps.length);
    expect(hi.steps[0].target).toBe(tour.steps[0].target);
    expect(hi.steps[0].body).not.toBe(tour.steps[0].body);
    expect(localizeTour(tour, 'kn')).toBe(tour);
    expect(localizeTour(tour, 'en')).toBe(tour);
  });

  it('localizes the mobile steps from their own copy', () => {
    const tour = TOURS.find((t) => t.id === 'send-broadcast')!;
    const mobile = {
      id: tour.id,
      title: tour.title,
      description: tour.description,
      steps: tour.mobileSteps!,
    };
    const hi = localizeMobileTour(mobile, 'hi');
    expect(hi.steps).toHaveLength(2);
    expect(hi.steps[0].body).toBe(
      tourCopyFor('send-broadcast', 'hi')!.mobileSteps![0].body
    );
    expect(hi.steps[0].body).not.toBe(tour.mobileSteps![0].body);
  });
});
