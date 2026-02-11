-- Migration: Add workspace_layout JSONB column to profiles table
-- Stores the user's customizable workspace dashboard layout.
-- NULL means "use default layout" — zero cost for existing users.

ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS workspace_layout JSONB DEFAULT NULL;
