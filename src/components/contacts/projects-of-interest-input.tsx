'use client';

import { Input } from '@/components/ui/input';

interface ProjectsOfInterestInputProps {
  /** Raw comma-separated text, so a half-typed name survives re-render. */
  projectsText: string;
  projects: string[];
  strict: boolean;
  onChange: (projectsText: string, projects: string[]) => void;
  onStrictChange: (strict: boolean) => void;
  /** Distinguishes the checkbox id when two editors share a page. */
  idPrefix: string;
}

/**
 * Named-project watchlist. A buyer who asks for one society by name is
 * giving the strongest signal the matching engine reads, and until now
 * it could only arrive through AI extraction of the requirements text.
 * The strict toggle is the other half of the question worth asking:
 * whether the project is the requirement or just the example.
 */
export function ProjectsOfInterestInput({
  projectsText,
  projects,
  strict,
  onChange,
  onStrictChange,
  idPrefix,
}: ProjectsOfInterestInputProps) {
  function handleTextChange(value: string) {
    const parsed = value
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    onChange(value, Array.from(new Set(parsed)));
  }

  return (
    <>
      <Input
        value={projectsText}
        onChange={(e) => handleTextChange(e.target.value)}
        placeholder="Type project (e.g. Purva Westend, Prestige Lakeside)..."
        className="bg-slate-800 border-slate-700 text-white placeholder:text-slate-500 h-8 text-xs w-full focus-visible:ring-1 focus-visible:ring-primary focus-visible:ring-offset-0"
      />

      <div className="flex items-center space-x-2 pt-2">
        <input
          type="checkbox"
          id={`${idPrefix}-strict-project-match`}
          checked={strict}
          disabled={projects.length === 0}
          onChange={(e) => onStrictChange(e.target.checked)}
          className="rounded border-slate-700 bg-slate-800 text-primary focus:ring-0 focus:ring-offset-0 size-3.5 disabled:opacity-40"
        />
        <label
          htmlFor={`${idPrefix}-strict-project-match`}
          className="text-[11px] text-slate-400 font-medium cursor-pointer select-none"
        >
          Only these projects (hides every other listing from this client)
        </label>
      </div>
      <p className="text-[10px] text-slate-500">
        {projects.length === 0
          ? 'Leave blank if the client is open on the project.'
          : strict
            ? 'Nothing outside these projects will match, alert or digest.'
            : 'These rank first; other listings that fit still come through.'}
      </p>
    </>
  );
}
