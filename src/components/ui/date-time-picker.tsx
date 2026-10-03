'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock,
  Check,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface DateTimePickerProps {
  value: string; // expects YYYY-MM-DDTHH:MM
  onChange: (val: string) => void;
  className?: string;
  disabled?: boolean;
  id?: string;
  align?: 'left' | 'right';
}

export function DateTimePicker({
  value,
  onChange,
  className,
  disabled = false,
  id,
  align = 'left',
}: DateTimePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Parse date directly from value prop (derived state to maintain a single source of truth)
  const initialDate = value ? new Date(value) : new Date();
  const selectedDate = isNaN(initialDate.getTime()) ? new Date() : initialDate;

  const [currentYear, setCurrentYear] = useState(selectedDate.getFullYear());
  const [currentMonth, setCurrentMonth] = useState(selectedDate.getMonth()); // 0-11

  // Sync month and year paged view when the date value prop updates externally
  const [prevValue, setPrevValue] = useState(value);
  if (value !== prevValue) {
    setPrevValue(value);
    const parsed = new Date(value);
    if (!isNaN(parsed.getTime())) {
      setCurrentYear(parsed.getFullYear());
      setCurrentMonth(parsed.getMonth());
    }
  }

  // Click outside listener to close the popover
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const pad = (n: number) => n.toString().padStart(2, '0');

  // Convert Date object to datetime-local string format
  const formatToISOString = (d: Date): string => {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const getDisplayString = (): string => {
    if (!value) return 'Select date and time';
    const d = new Date(value);
    if (isNaN(d.getTime())) return 'Select date and time';

    const monthName = d.toLocaleString('en-US', { month: 'short' });
    const day = d.getDate();
    const year = d.getFullYear();
    let hours = d.getHours();
    const minutes = pad(d.getMinutes());
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12; // 0 should be 12

    return `${monthName} ${day}, ${year} at ${hours}:${minutes} ${ampm}`;
  };

  // Month navigation
  const handlePrevMonth = () => {
    if (currentMonth === 0) {
      setCurrentMonth(11);
      setCurrentYear(currentYear - 1);
    } else {
      setCurrentMonth(currentMonth - 1);
    }
  };

  const handleNextMonth = () => {
    if (currentMonth === 11) {
      setCurrentMonth(0);
      setCurrentYear(currentYear + 1);
    } else {
      setCurrentMonth(currentMonth + 1);
    }
  };

  // Calendar cell builder (6 rows x 7 cols = 42 cells)
  const getCalendarCells = () => {
    const firstDayIndex = new Date(currentYear, currentMonth, 1).getDay();
    const daysInPrevMonth = new Date(currentYear, currentMonth, 0).getDate();
    const daysInCurrentMonth = new Date(
      currentYear,
      currentMonth + 1,
      0
    ).getDate();

    const cells = [];

    // Prev month padding
    for (let i = firstDayIndex - 1; i >= 0; i--) {
      cells.push({
        day: daysInPrevMonth - i,
        month: currentMonth === 0 ? 11 : currentMonth - 1,
        year: currentMonth === 0 ? currentYear - 1 : currentYear,
        isCurrentMonth: false,
      });
    }

    // Current month days
    for (let i = 1; i <= daysInCurrentMonth; i++) {
      cells.push({
        day: i,
        month: currentMonth,
        year: currentYear,
        isCurrentMonth: true,
      });
    }

    // Next month padding
    const remaining = 42 - cells.length;
    for (let i = 1; i <= remaining; i++) {
      cells.push({
        day: i,
        month: currentMonth === 11 ? 0 : currentMonth + 1,
        year: currentMonth === 11 ? currentYear + 1 : currentYear,
        isCurrentMonth: false,
      });
    }

    return cells;
  };

  const handleDateSelect = (cell: {
    day: number;
    month: number;
    year: number;
  }) => {
    const nextDate = new Date(selectedDate);
    nextDate.setFullYear(cell.year);
    nextDate.setMonth(cell.month);
    nextDate.setDate(cell.day);
    onChange(formatToISOString(nextDate));
  };

  const handleTimeSelect = (
    type: 'hour' | 'minute' | 'ampm',
    val: string | number
  ) => {
    const nextDate = new Date(selectedDate);
    let hours = nextDate.getHours();

    if (type === 'hour') {
      const isPM = hours >= 12;
      const newHour = Number(val);
      if (newHour === 12) {
        hours = isPM ? 12 : 0;
      } else {
        hours = isPM ? newHour + 12 : newHour;
      }
    } else if (type === 'minute') {
      nextDate.setMinutes(Number(val));
      onChange(formatToISOString(nextDate));
      return;
    } else if (type === 'ampm') {
      const currentIsPM = hours >= 12;
      if (val === 'PM' && !currentIsPM) {
        hours += 12;
      } else if (val === 'AM' && currentIsPM) {
        hours -= 12;
      }
    }

    nextDate.setHours(hours);
    onChange(formatToISOString(nextDate));
  };

  const handleToday = () => {
    const today = new Date();
    setCurrentMonth(today.getMonth());
    setCurrentYear(today.getFullYear());
    onChange(formatToISOString(today));
  };

  const handleClear = () => {
    onChange('');
    setIsOpen(false);
  };

  const monthNames = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];

  const daysOfWeek = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

  // Current selected values for clock wheels
  const currentHoursRaw = selectedDate.getHours();
  const isPM = currentHoursRaw >= 12;
  const currentHourSelected =
    currentHoursRaw % 12 === 0 ? 12 : currentHoursRaw % 12;
  const currentMinuteSelected = selectedDate.getMinutes();

  return (
    <div className="relative w-full" ref={containerRef} id={id}>
      {/* Trigger Button */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          'focus:border-primary flex h-9 w-full cursor-pointer items-center justify-between rounded-lg border border-slate-700 bg-slate-800 px-3 text-left text-sm text-white shadow-sm transition-all hover:bg-slate-800/80 focus:outline-none disabled:opacity-60',
          isOpen && 'border-primary ring-primary/20 ring-1',
          className
        )}
      >
        <span className="flex items-center gap-2 truncate text-slate-200">
          <CalendarDays className="text-primary size-4 shrink-0" />
          <span className={cn(!value && 'text-slate-400')}>
            {getDisplayString()}
          </span>
        </span>
        <Clock className="ml-1 size-3.5 shrink-0 text-slate-400" />
      </button>

      {/* Popover */}
      {isOpen && (
        <div
          className={cn(
            'animate-in fade-in-50 zoom-in-95 absolute z-[9999] mt-1.5 flex w-[310px] flex-row gap-3 rounded-xl border border-slate-800 bg-slate-950 p-3 shadow-2xl shadow-slate-950/80 duration-100 sm:w-[420px] sm:gap-4 sm:p-4 md:w-[450px]',
            align === 'right' ? 'right-0' : 'left-0'
          )}
        >
          {/* Calendar Picker Panel */}
          <div className="flex-1">
            <div className="mb-3.5 flex items-center justify-between">
              <span className="max-w-[120px] truncate text-xs font-semibold text-white sm:max-w-none sm:text-sm">
                {monthNames[currentMonth]} {currentYear}
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={handlePrevMonth}
                  className="rounded border border-slate-800 bg-slate-900 p-1 text-slate-300 transition-colors hover:bg-slate-800 hover:text-white"
                >
                  <ChevronLeft className="size-3 sm:size-3.5" />
                </button>
                <button
                  type="button"
                  onClick={handleNextMonth}
                  className="rounded border border-slate-800 bg-slate-900 p-1 text-slate-300 transition-colors hover:bg-slate-800 hover:text-white"
                >
                  <ChevronRight className="size-3 sm:size-3.5" />
                </button>
              </div>
            </div>

            {/* Days Headings */}
            <div className="mb-1 grid grid-cols-7 gap-0.5 text-center text-[9px] font-bold tracking-wider text-slate-500 uppercase sm:gap-1 sm:text-[10px]">
              {daysOfWeek.map((day, idx) => (
                <div
                  key={idx}
                  className="flex h-5 items-center justify-center sm:h-6"
                >
                  {day}
                </div>
              ))}
            </div>

            {/* Day Cells */}
            <div className="grid grid-cols-7 gap-0.5 sm:gap-1">
              {getCalendarCells().map((cell, idx) => {
                const isSelected =
                  selectedDate.getDate() === cell.day &&
                  selectedDate.getMonth() === cell.month &&
                  selectedDate.getFullYear() === cell.year;

                const isToday =
                  new Date().getDate() === cell.day &&
                  new Date().getMonth() === cell.month &&
                  new Date().getFullYear() === cell.year;

                return (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => handleDateSelect(cell)}
                    className={cn(
                      'flex size-7 cursor-pointer items-center justify-center rounded-lg border border-transparent text-xs font-medium transition-all sm:size-8',
                      !cell.isCurrentMonth &&
                        'text-slate-600 hover:text-slate-400',
                      cell.isCurrentMonth &&
                        'text-slate-200 hover:bg-slate-900 hover:text-white',
                      isToday &&
                        'text-primary border-slate-800 bg-slate-900/30 font-bold',
                      isSelected &&
                        'from-primary hover:bg-primary/90 border-transparent bg-gradient-to-tr to-violet-600 font-bold text-white'
                    )}
                  >
                    {cell.day}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Time Picker Panel (Hour / Minute / Period Scroll) */}
          <div className="border-slate-850 flex w-[85px] shrink-0 flex-col justify-between border-l pl-2.5 sm:w-[120px] sm:pl-4">
            <div className="text-slate-450 mb-2 flex items-center gap-1 text-[10px] font-semibold sm:mb-3 sm:text-xs">
              <Clock className="text-primary size-3 shrink-0 sm:size-3.5" />
              <span>Time</span>
            </div>

            {/* Time Columns */}
            <div className="flex h-[125px] gap-1 overflow-hidden sm:h-[156px] sm:gap-2">
              {/* Hour Scroll */}
              <div className="flex flex-1 scrollbar-none flex-col space-y-1 overflow-y-auto">
                {Array.from({ length: 12 }, (_, i) => i + 1).map((hour) => (
                  <button
                    key={hour}
                    type="button"
                    onClick={() => handleTimeSelect('hour', hour)}
                    className={cn(
                      'h-7 w-full shrink-0 cursor-pointer rounded-md text-center text-xs transition-colors',
                      currentHourSelected === hour
                        ? 'bg-primary text-primary-foreground font-semibold'
                        : 'text-slate-350 hover:bg-slate-900 hover:text-white'
                    )}
                  >
                    {pad(hour)}
                  </button>
                ))}
              </div>

              {/* Minute Scroll */}
              <div className="flex flex-1 scrollbar-none flex-col space-y-1 overflow-y-auto">
                {Array.from({ length: 12 }, (_, i) => i * 5).map((minute) => (
                  <button
                    key={minute}
                    type="button"
                    onClick={() => handleTimeSelect('minute', minute)}
                    className={cn(
                      'h-7 w-full shrink-0 cursor-pointer rounded-md text-center text-xs transition-colors',
                      currentMinuteSelected === minute
                        ? 'bg-primary text-primary-foreground font-semibold'
                        : 'text-slate-350 hover:bg-slate-900 hover:text-white'
                    )}
                  >
                    {pad(minute)}
                  </button>
                ))}
              </div>

              {/* AM / PM Scroll */}
              <div className="flex w-[30px] shrink-0 flex-col space-y-1 sm:w-[36px]">
                {['AM', 'PM'].map((period) => {
                  const isActive =
                    (period === 'PM' && isPM) || (period === 'AM' && !isPM);
                  return (
                    <button
                      key={period}
                      type="button"
                      onClick={() => handleTimeSelect('ampm', period)}
                      className={cn(
                        'h-7 w-full shrink-0 cursor-pointer rounded-md text-center text-xs transition-colors',
                        isActive
                          ? 'bg-primary text-primary-foreground font-semibold'
                          : 'text-slate-350 hover:bg-slate-900 hover:text-white'
                      )}
                    >
                      {period}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Bottom Actions */}
            <div className="border-slate-850 mt-2 flex items-center justify-between gap-1.5 border-t pt-2 sm:mt-3.5 sm:gap-2 sm:pt-3.5">
              <button
                type="button"
                onClick={handleClear}
                className="text-[9px] font-semibold tracking-wider text-slate-500 uppercase transition-colors hover:text-rose-400 sm:text-[10px]"
              >
                Clear
              </button>
              <div className="flex items-center gap-1 sm:gap-1.5">
                <button
                  type="button"
                  onClick={handleToday}
                  className="border-slate-850 rounded border bg-slate-900 px-1.5 py-0.5 text-[9px] font-semibold tracking-wider text-slate-300 uppercase transition-colors hover:bg-slate-800 sm:px-2 sm:py-1 sm:text-[10px]"
                >
                  Today
                </button>
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="bg-primary text-primary-foreground rounded p-1 transition-all hover:opacity-95"
                >
                  <Check className="size-2.5 sm:size-3" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
