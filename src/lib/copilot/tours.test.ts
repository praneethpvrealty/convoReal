import { describe, expect, it } from 'vitest';
import { TOURS, getTour } from './tours';

describe('tour registry invariants', () => {
  it('has unique tour ids', () => {
    const ids = TOURS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every tour has at least 2 steps and complete metadata', () => {
    for (const tour of TOURS) {
      expect(tour.steps.length, tour.id).toBeGreaterThanOrEqual(2);
      expect(tour.title, tour.id).toBeTruthy();
      expect(tour.description, tour.id).toBeTruthy();
      expect(tour.triggers.length, tour.id).toBeGreaterThan(0);
    }
  });

  it('every step has a target, title, body and valid advanceOn', () => {
    for (const tour of TOURS) {
      for (const step of tour.steps) {
        const label = `${tour.id}/${step.target}`;
        expect(step.target, label).toBeTruthy();
        expect(step.title, label).toBeTruthy();
        expect(step.body, label).toBeTruthy();
        expect(['click-target', 'next', 'route-change'], label).toContain(
          step.advanceOn,
        );
        expect(step.route.startsWith('/'), label).toBe(true);
      }
    }
  });

  it('the first step of every tour is reachable from anywhere', () => {
    // Tours can start on any page — step 1 must prefix-match '/' so
    // the engine never immediately declares the tour "lost".
    for (const tour of TOURS) {
      const first = tour.steps[0];
      expect(first.routeMatch, tour.id).toBe('prefix');
      expect(first.route, tour.id).toBe('/');
    }
  });

  it('no step is both a Next-button step and a skippable nav step', () => {
    for (const tour of TOURS) {
      for (const step of tour.steps) {
        if (step.advanceOn === 'next') {
          expect(step.skipIfNextRouteActive, `${tour.id}/${step.target}`).toBeFalsy();
        }
      }
    }
  });

  it('skipIfNextRouteActive steps always have a next step', () => {
    for (const tour of TOURS) {
      tour.steps.forEach((step, i) => {
        if (step.skipIfNextRouteActive) {
          expect(tour.steps[i + 1], `${tour.id}[${i}]`).toBeDefined();
        }
      });
    }
  });

  it('getTour resolves ids and rejects unknowns', () => {
    expect(getTour('add-contact')?.id).toBe('add-contact');
    expect(getTour('nope')).toBeUndefined();
  });
});
