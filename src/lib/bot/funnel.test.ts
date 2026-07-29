import { describe, expect, it } from 'vitest';
import {
  answerList,
  answerText,
  funnelStep,
  looksLikeQuestion,
  nextStepId,
  recordAnswer,
  type Funnel,
  type FunnelStep,
} from './funnel';

const multiStep: FunnelStep = {
  id: 'locality',
  ask: 'Where?',
  multi: true,
  key: 'locality',
  next: 'budget',
};

const singleStep: FunnelStep = {
  id: 'category',
  ask: 'What?',
  key: 'category',
  next: 'locality',
};

const funnel: Funnel = {
  id: 'showcase',
  first: 'category',
  steps: [singleStep, multiStep],
};

describe('recordAnswer', () => {
  it('overwrites a single-select answer', () => {
    const first = recordAnswer(singleStep, 'Villa', {});
    expect(recordAnswer(singleStep, 'Plot', first)).toEqual({
      category: 'Plot',
    });
  });

  it('accumulates multi-select answers', () => {
    const one = recordAnswer(multiStep, 'Whitefield', {});
    const two = recordAnswer(multiStep, 'Indiranagar', one);
    expect(two.locality).toEqual(['Whitefield', 'Indiranagar']);
  });

  it('toggles a repeated multi-select answer back off', () => {
    const one = recordAnswer(multiStep, 'Whitefield', {});
    const two = recordAnswer(multiStep, 'Indiranagar', one);
    expect(recordAnswer(multiStep, 'whitefield', two).locality).toEqual([
      'Indiranagar',
    ]);
  });

  it('ignores blank answers', () => {
    expect(recordAnswer(singleStep, '   ', { category: 'Villa' })).toEqual({
      category: 'Villa',
    });
  });
});

describe('nextStepId', () => {
  it('follows a static next', () => {
    expect(nextStepId(singleStep, 'Villa', {})).toBe('locality');
  });

  it('follows a branching next', () => {
    const branching: FunnelStep = {
      id: 'intent',
      ask: 'Why?',
      key: 'intent',
      next: (answer) => (answer === 'Renting' ? 'rent_budget' : 'budget'),
    };
    expect(nextStepId(branching, 'Renting', {})).toBe('rent_budget');
    expect(nextStepId(branching, 'Buying', {})).toBe('budget');
  });
});

describe('funnelStep', () => {
  it('resolves known ids and rejects sentinels', () => {
    expect(funnelStep(funnel, 'category')).toBe(singleStep);
    expect(funnelStep(funnel, '__end__')).toBeNull();
  });
});

describe('looksLikeQuestion', () => {
  it('treats trailing question marks and question words as questions', () => {
    expect(looksLikeQuestion('do you have plots?', singleStep)).toBe(true);
    expect(looksLikeQuestion('What areas do you cover', singleStep)).toBe(true);
    expect(looksLikeQuestion('anything under 1cr', singleStep)).toBe(true);
  });

  it('treats plain answers as answers', () => {
    expect(looksLikeQuestion('Villa', singleStep)).toBe(false);
    expect(looksLikeQuestion('Whitefield', multiStep)).toBe(false);
    expect(looksLikeQuestion('Ravi Kumar', singleStep)).toBe(false);
  });

  it('never mistakes a phone number for a question', () => {
    const phoneStep: FunnelStep = {
      id: 'phone',
      ask: 'Number?',
      input: 'tel',
      key: 'phone',
      next: '__end__',
    };
    expect(looksLikeQuestion('9845012345', phoneStep)).toBe(false);
    expect(looksLikeQuestion('is 9845012345 ok?', phoneStep)).toBe(false);
  });
});

describe('answer readers', () => {
  it('reads multi and single answers uniformly', () => {
    expect(answerList({ locality: ['A', 'B'] }, 'locality')).toEqual([
      'A',
      'B',
    ]);
    expect(answerList({ locality: 'A' }, 'locality')).toEqual(['A']);
    expect(answerList({}, 'locality')).toEqual([]);
    expect(answerText({ locality: ['A', 'B'] }, 'locality')).toBe('A, B');
    expect(answerText({}, 'name')).toBe('');
  });
});
