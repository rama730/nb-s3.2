-- Keep project_node_events sequence numbers durable for legacy/default inserts.
-- Some older write paths omit sequence_number; this trigger allocates a
-- project-local monotonic sequence from projects.current_sequence_number.

CREATE OR REPLACE FUNCTION public.allocate_project_node_event_sequence()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  next_sequence bigint;
BEGIN
  IF NEW.sequence_number IS NULL OR NEW.sequence_number = 0 THEN
    UPDATE public.projects
    SET current_sequence_number = COALESCE(current_sequence_number, 0) + 1
    WHERE id = NEW.project_id
    RETURNING current_sequence_number INTO next_sequence;

    IF next_sequence IS NULL THEN
      RAISE EXCEPTION 'Project % not found while allocating project_node_events.sequence_number', NEW.project_id;
    END IF;

    NEW.sequence_number := next_sequence;
  ELSE
    UPDATE public.projects
    SET current_sequence_number = GREATEST(COALESCE(current_sequence_number, 0), NEW.sequence_number)
    WHERE id = NEW.project_id;
  END IF;

  RETURN NEW;
END;
$$;

ALTER TABLE public.project_node_events
  ALTER COLUMN sequence_number SET DEFAULT 0;

DROP TRIGGER IF EXISTS project_node_events_sequence_before_insert ON public.project_node_events;

CREATE TRIGGER project_node_events_sequence_before_insert
BEFORE INSERT ON public.project_node_events
FOR EACH ROW
EXECUTE FUNCTION public.allocate_project_node_event_sequence();
