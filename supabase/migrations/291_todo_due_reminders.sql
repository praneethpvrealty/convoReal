ALTER TABLE public.todos
  ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_todos_due_reminder_pending
  ON public.todos (due_date)
  WHERE completed = FALSE
    AND reminder_sent_at IS NULL
    AND due_date IS NOT NULL;

CREATE OR REPLACE FUNCTION public.reset_todo_reminder_on_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.due_date IS DISTINCT FROM OLD.due_date
    OR (OLD.completed = TRUE AND NEW.completed = FALSE)
  THEN
    NEW.reminder_sent_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.reset_todo_reminder_on_change()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS reset_todo_reminder_on_change ON public.todos;
CREATE TRIGGER reset_todo_reminder_on_change
  BEFORE UPDATE OF due_date, completed
  ON public.todos
  FOR EACH ROW
  EXECUTE FUNCTION public.reset_todo_reminder_on_change();

COMMENT ON COLUMN public.todos.reminder_sent_at IS
  'When the exact-time agent reminder was claimed; cleared when the task is rescheduled or reopened.';
