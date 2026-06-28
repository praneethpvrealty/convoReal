'use client';

import React, { useState, useEffect, useRef } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Clock, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

interface DateTimePickerProps {
  value: string; // expects YYYY-MM-DDTHH:MM
  onChange: (val: string) => void;
  className?: string;
  disabled?: boolean;
  id?: string;
}

export function DateTimePicker({
  value,
  onChange,
  className,
  disabled = false,
  id,
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
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
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
    const daysInCurrentMonth = new Date(currentYear, currentMonth + 1, 0).getDate();

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

  const handleDateSelect = (cell: { day: number; month: number; year: number }) => {
    const nextDate = new Date(selectedDate);
    nextDate.setFullYear(cell.year);
    nextDate.setMonth(cell.month);
    nextDate.setDate(cell.day);
    onChange(formatToISOString(nextDate));
  };

  const handleTimeSelect = (type: 'hour' | 'minute' | 'ampm', val: string | number) => {
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
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  const daysOfWeek = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

  // Current selected values for clock wheels
  const currentHoursRaw = selectedDate.getHours();
  const isPM = currentHoursRaw >= 12;
  const currentHourSelected = currentHoursRaw % 12 === 0 ? 12 : currentHoursRaw % 12;
  const currentMinuteSelected = selectedDate.getMinutes();

  return (
    <div className="relative w-full" ref={containerRef} id={id}>
      {/* Trigger Button */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "flex w-full h-9 items-center justify-between rounded-lg border border-slate-700 bg-slate-800 px-3 text-sm text-white focus:border-primary focus:outline-none disabled:opacity-60 transition-all hover:bg-slate-800/80 cursor-pointer shadow-sm text-left",
          isOpen && "border-primary ring-1 ring-primary/20",
          className
        )}
      >
        <span className="flex items-center gap-2 truncate text-slate-200">
          <CalendarDays className="size-4 text-primary shrink-0" />
          <span className={cn(!value && "text-slate-400")}>{getDisplayString()}</span>
        </span>
        <Clock className="size-3.5 text-slate-400 shrink-0 ml-1" />
      </button>

      {/* Popover */}
      {isOpen && (
        <div className="absolute z-[9999] mt-1.5 p-4 rounded-xl border border-slate-800 bg-slate-950 shadow-2xl shadow-slate-950/80 w-[340px] md:w-[480px] flex flex-col md:flex-row gap-4 animate-in fade-in-50 zoom-in-95 duration-100 right-0 md:left-0">
          
          {/* Calendar Picker Panel */}
          <div className="flex-1">
            <div className="flex items-center justify-between mb-3.5">
              <span className="text-sm font-semibold text-white">
                {monthNames[currentMonth]} {currentYear}
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={handlePrevMonth}
                  className="p-1 rounded bg-slate-900 border border-slate-800 hover:bg-slate-800 text-slate-300 hover:text-white transition-colors"
                >
                  <ChevronLeft className="size-3.5" />
                </button>
                <button
                  type="button"
                  onClick={handleNextMonth}
                  className="p-1 rounded bg-slate-900 border border-slate-800 hover:bg-slate-800 text-slate-300 hover:text-white transition-colors"
                >
                  <ChevronRight className="size-3.5" />
                </button>
              </div>
            </div>

            {/* Days Headings */}
            <div className="grid grid-cols-7 gap-1 text-center mb-1 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
              {daysOfWeek.map((day, idx) => (
                <div key={idx} className="h-6 flex items-center justify-center">
                  {day}
                </div>
              ))}
            </div>

            {/* Day Cells */}
            <div className="grid grid-cols-7 gap-1">
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
                      "size-8 rounded-lg flex items-center justify-center text-xs transition-all cursor-pointer font-medium border border-transparent",
                      !cell.isCurrentMonth && "text-slate-600 hover:text-slate-400",
                      cell.isCurrentMonth && "text-slate-200 hover:bg-slate-900 hover:text-white",
                      isToday && "border-slate-800 text-primary font-bold bg-slate-900/30",
                      isSelected && "bg-gradient-to-tr from-primary to-violet-600 text-white font-bold border-transparent hover:bg-primary/90"
                    )}
                  >
                    {cell.day}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Time Picker Panel (Hour / Minute / Period Scroll) */}
          <div className="w-full md:w-[150px] border-t md:border-t-0 md:border-l border-slate-850 pt-3 md:pt-0 md:pl-4 flex flex-col justify-between">
            <div className="flex items-center gap-1.5 text-xs text-slate-450 font-semibold mb-3">
              <Clock className="size-3.5 text-primary" />
              <span>Time Selection</span>
            </div>

            {/* Time Columns */}
            <div className="flex gap-2 h-[156px] overflow-hidden">
              
              {/* Hour Scroll */}
              <div className="flex-1 flex flex-col overflow-y-auto scrollbar-none space-y-1">
                {Array.from({ length: 12 }, (_, i) => i + 1).map((hour) => (
                  <button
                    key={hour}
                    type="button"
                    onClick={() => handleTimeSelect('hour', hour)}
                    className={cn(
                      "h-7 w-full shrink-0 text-center text-xs rounded-md transition-colors cursor-pointer",
                      currentHourSelected === hour
                        ? "bg-primary text-primary-foreground font-semibold"
                        : "text-slate-355 hover:bg-slate-900 hover:text-white"
                    )}
                  >
                    {pad(hour)}
                  </button>
                ))}
              </div>

              {/* Minute Scroll */}
              <div className="flex-1 flex flex-col overflow-y-auto scrollbar-none space-y-1">
                {Array.from({ length: 12 }, (_, i) => i * 5).map((minute) => (
                  <button
                    key={minute}
                    type="button"
                    onClick={() => handleTimeSelect('minute', minute)}
                    className={cn(
                      "h-7 w-full shrink-0 text-center text-xs rounded-md transition-colors cursor-pointer",
                      currentMinuteSelected === minute
                        ? "bg-primary text-primary-foreground font-semibold"
                        : "text-slate-355 hover:bg-slate-900 hover:text-white"
                    )}
                  >
                    {pad(minute)}
                  </button>
                ))}
              </div>

              {/* AM / PM Scroll */}
              <div className="w-[36px] flex flex-col space-y-1 shrink-0">
                {['AM', 'PM'].map((period) => {
                  const isActive = (period === 'PM' && isPM) || (period === 'AM' && !isPM);
                  return (
                    <button
                      key={period}
                      type="button"
                      onClick={() => handleTimeSelect('ampm', period)}
                      className={cn(
                        "h-7 w-full shrink-0 text-center text-xs rounded-md transition-colors cursor-pointer",
                        isActive
                          ? "bg-primary text-primary-foreground font-semibold"
                          : "text-slate-355 hover:bg-slate-900 hover:text-white"
                      )}
                    >
                      {period}
                    </button>
                  );
                })}
              </div>

            </div>

            {/* Bottom Actions */}
            <div className="flex items-center justify-between border-t border-slate-850 pt-3.5 mt-3.5 gap-2">
              <button
                type="button"
                onClick={handleClear}
                className="text-[10px] font-semibold text-slate-500 hover:text-rose-400 transition-colors uppercase tracking-wider"
              >
                Clear
              </button>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={handleToday}
                  className="px-2 py-1 rounded bg-slate-900 border border-slate-850 hover:bg-slate-800 text-[10px] font-semibold text-slate-300 transition-colors uppercase tracking-wider"
                >
                  Today
                </button>
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="p-1 rounded bg-primary text-primary-foreground hover:opacity-95 transition-all"
                >
                  <Check className="size-3" />
                </button>
              </div>
            </div>
          </div>

        </div>
      )}
    </div>
  );
}
