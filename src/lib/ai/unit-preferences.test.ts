import { describe, expect, it } from 'vitest';
import {
  floorRangeLabel,
  hasUnitPreferences,
  normalizeFacing,
  normalizeTower,
  sanitizeUnitPreferences,
  unitPreferenceLabels,
  unitPreferencesFromRequirement,
} from './unit-preferences';

describe('unitPreferencesFromRequirement', () => {
  it('[CNV-016] reads the 15 November brief: facing, tower and floor range', () => {
    expect(
      unitPreferencesFromRequirement(
        'I need 1851 sft in Prestige meridian\nEast facing in tower 10 above 8th to 28 floor'
      )
    ).toEqual({
      facing: ['East'],
      towers: ['10'],
      floor_min: 8,
      floor_max: 28,
    });
  });

  it.each([
    ['North-East or East facing 3 BHK', ['North-East', 'East']],
    ['north east facing flat', ['North-East']],
    ['facing: West', ['West']],
    ['facing east in tower 10', ['East']],
    ['not a west facing one, east facing only', ['East']],
    ['East facing not West', ['East']],
    ['East facing no brokers please', ['East']],
    ['Facing should be north or east', ['North', 'East']],
    ['NE facing villa', ['North-East']],
    ['east/north facing only', ['East', 'North']],
    ['East facing, not facing West', ['East']],
  ])('[CNV-016] reads the facing in "%s"', (text, facing) => {
    expect(unitPreferencesFromRequirement(text).facing).toEqual(facing);
  });

  it.each([
    'not west facing',
    'not facing West',
    'avoid facing south or west',
    'West facing not preferred',
    'west facing no',
    'South facing not required',
    "I don't want west facing",
    'non-west facing',
    'Lake facing North Bangalore 3BHK',
    'looking in East Bangalore, north of the lake',
    'park facing flat',
    'road facing shop in South Extension',
  ])('[CNV-016] reads no wanted facing in "%s"', (text) => {
    expect(unitPreferencesFromRequirement(text).facing).toEqual([]);
  });

  it.each([
    ['tower 10', ['10']],
    ['Tower B or C', ['B', 'C']],
    ['towers 3, 4 and 12A', ['3', '4', '12A']],
    ['Wing A', ['A']],
    ['tower no. 07', ['7']],
  ])('[CNV-016] reads the tower in "%s"', (text, towers) => {
    expect(unitPreferencesFromRequirement(text).towers).toEqual(towers);
  });

  it.each([
    'a tower in Whitefield',
    'near the clock tower',
    'Jayanagar 4th Block',
    'tower a nice view',
  ])('[CNV-016] reads no tower in "%s"', (text) => {
    expect(unitPreferencesFromRequirement(text).towers).toEqual([]);
  });

  it.each([
    ['8th to 28th floor', 8, 28],
    ['floors 5-10', 5, 10],
    ['between 3 and 9 floor', 3, 9],
    ['above 10th floor', 11, null],
    ['10th floor and above', 10, null],
    ['minimum 5th floor', 5, null],
    ['below 5th floor', null, 4],
    ['up to 4th floor', null, 4],
    ['not above 10th floor', null, 10],
    ['not below 5th floor', 5, null],
    ['on the 12th floor', 12, 12],
    ['12th floor 2 to 3 BHK in Whitefield', 12, 12],
    ['floor no 7', 7, 7],
    ['ground floor only', 0, 0],
    ['Ground floor no steps', 0, 0],
    ['no ground floor please', 1, null],
    ['not on ground floor', 1, null],
    ['avoid ground floor', 1, null],
    ['any floor above ground floor', 1, null],
    ['above 8th to 28 floors', 8, 28],
  ])('[CNV-016] reads the floors in "%s"', (text, min, max) => {
    const prefs = unitPreferencesFromRequirement(text);
    expect([prefs.floor_min, prefs.floor_max]).toEqual([min, max]);
  });

  it.each([
    'G+2 floors building',
    '4 floors independent house',
    'higher floor preferred',
    'Higher floor 2-3 BHK',
    'higher floor 1-1.5 Cr',
    'no 13th floor',
    'independent house with 2 to 3 floors',
    'minimum 3 floors',
    'building with over 10 floors',
    'up to 4 floors',
    'wooden flooring',
    'budget 80 to 90 lakh',
  ])('[CNV-016] reads no floor range in "%s"', (text) => {
    const prefs = unitPreferencesFromRequirement(text);
    expect([prefs.floor_min, prefs.floor_max]).toEqual([null, null]);
  });
});

describe('unit preference helpers', () => {
  it('[CNV-016] normalises a listing facing and tower to the stored vocabulary', () => {
    expect(normalizeFacing('north east')).toBe('North-East');
    expect(normalizeFacing('EAST')).toBe('East');
    expect(normalizeFacing('Park')).toBeNull();
    expect(normalizeTower('Tower 10')).toBe('10');
    expect(normalizeTower('tower-b')).toBe('B');
    expect(normalizeTower('')).toBeNull();
  });

  it('[CNV-016] drops values outside the vocabulary on the way in', () => {
    expect(
      sanitizeUnitPreferences({
        facing: ['east', 'Sideways', 'East'],
        towers: ['Tower 10', '10', ''],
        floor_min: '8',
        floor_max: 900,
      })
    ).toEqual({
      facing: ['East'],
      towers: ['10'],
      floor_min: 8,
      floor_max: null,
    });
  });

  it('[CNV-016] labels what is stated and nothing else', () => {
    expect(
      unitPreferenceLabels({
        facing: ['East'],
        towers: ['10'],
        floor_min: 8,
        floor_max: 28,
      })
    ).toEqual(['East facing', 'Tower 10', '8th–28th floor']);
    expect(floorRangeLabel(11, null)).toBe('11th floor and above');
    expect(floorRangeLabel(null, 4)).toBe('Up to 4th floor');
    expect(floorRangeLabel(0, 0)).toBe('Ground floor');
    expect(unitPreferenceLabels({ facing: [], towers: [] })).toEqual([]);
    expect(hasUnitPreferences({ facing: [], towers: [] })).toBe(false);
    expect(hasUnitPreferences({ floor_min: 0 })).toBe(true);
  });
});
