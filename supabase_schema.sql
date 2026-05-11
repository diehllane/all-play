-- PokeNexus Hybrid All-Play Event System
-- Supabase Schema

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- USERS / ROLES
-- ============================================================
CREATE TABLE public.profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('super_admin', 'event_runner', 'scorer')),
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Event runner <-> scorer assignments (scorers belong to an event)
CREATE TABLE public.user_event_assignments (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  event_id UUID, -- FK added after events table created
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, event_id)
);

-- ============================================================
-- EVENTS
-- ============================================================
CREATE TABLE public.events (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  division_count INT NOT NULL CHECK (division_count BETWEEN 1 AND 4),
  status TEXT NOT NULL DEFAULT 'setup' CHECK (status IN ('setup', 'active', 'playoffs', 'completed')),
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add FK now that events exists
ALTER TABLE public.user_event_assignments 
  ADD CONSTRAINT fk_user_event_assignments_event 
  FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE;

-- ============================================================
-- DIVISIONS
-- ============================================================
CREATE TABLE public.divisions (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  event_id UUID REFERENCES public.events(id) ON DELETE CASCADE,
  division_number INT NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(event_id, division_number)
);

-- ============================================================
-- TEAMS
-- ============================================================
CREATE TABLE public.teams (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  event_id UUID REFERENCES public.events(id) ON DELETE CASCADE,
  division_id UUID REFERENCES public.divisions(id) ON DELETE CASCADE,
  team_number INT NOT NULL,
  name TEXT NOT NULL, -- e.g. "Victini Lovers"
  display_name TEXT GENERATED ALWAYS AS ('Team #' || team_number || ' ' || name) STORED,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(event_id, team_number)
);

-- ============================================================
-- ENCOUNTER CATEGORIES
-- ============================================================
CREATE TABLE public.categories (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  event_id UUID REFERENCES public.events(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  multiplier NUMERIC(10,2) NOT NULL DEFAULT 1.0,
  display_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- ROUND ROBIN SCHEDULE
-- ============================================================
CREATE TABLE public.schedule (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  event_id UUID REFERENCES public.events(id) ON DELETE CASCADE,
  division_id UUID REFERENCES public.divisions(id) ON DELETE CASCADE,
  day_number INT NOT NULL,
  home_team_id UUID REFERENCES public.teams(id),
  away_team_id UUID REFERENCES public.teams(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- DAILY SCORES
-- ============================================================
CREATE TABLE public.daily_scores (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  event_id UUID REFERENCES public.events(id) ON DELETE CASCADE,
  team_id UUID REFERENCES public.teams(id) ON DELETE CASCADE,
  day_number INT NOT NULL,
  is_finalized BOOLEAN DEFAULT FALSE,
  calculated_total NUMERIC(10,2) DEFAULT 0,
  submitted_by UUID REFERENCES public.profiles(id),
  submitted_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(team_id, day_number)
);

-- Score breakdown per category
CREATE TABLE public.score_entries (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  daily_score_id UUID REFERENCES public.daily_scores(id) ON DELETE CASCADE,
  category_id UUID REFERENCES public.categories(id),
  encounter_count INT NOT NULL DEFAULT 0,
  points_earned NUMERIC(10,2) GENERATED ALWAYS AS (encounter_count * 1.0) STORED, -- multiplied at application level
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- MATCHUP OUTCOMES (round robin)
-- ============================================================
CREATE TABLE public.matchup_outcomes (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  event_id UUID REFERENCES public.events(id) ON DELETE CASCADE,
  schedule_id UUID REFERENCES public.schedule(id) ON DELETE CASCADE,
  day_number INT NOT NULL,
  home_team_id UUID REFERENCES public.teams(id),
  away_team_id UUID REFERENCES public.teams(id),
  home_score NUMERIC(10,2),
  away_score NUMERIC(10,2),
  home_points INT, -- 3=win, 2=tie, 1=loss
  away_points INT,
  is_calculated BOOLEAN DEFAULT FALSE,
  calculated_at TIMESTAMPTZ,
  UNIQUE(schedule_id)
);

-- League Average vs each team per day
CREATE TABLE public.league_average_outcomes (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  event_id UUID REFERENCES public.events(id) ON DELETE CASCADE,
  team_id UUID REFERENCES public.teams(id) ON DELETE CASCADE,
  day_number INT NOT NULL,
  team_score NUMERIC(10,2),
  league_average_score NUMERIC(10,2),
  team_points INT, -- 3=win, 2=tie, 1=loss
  is_calculated BOOLEAN DEFAULT FALSE,
  calculated_at TIMESTAMPTZ,
  UNIQUE(team_id, day_number)
);

-- ============================================================
-- STANDINGS (materialized view-style table, recalculated)
-- ============================================================
CREATE TABLE public.standings (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  event_id UUID REFERENCES public.events(id) ON DELETE CASCADE,
  team_id UUID REFERENCES public.teams(id) ON DELETE CASCADE,
  division_id UUID REFERENCES public.divisions(id),
  total_points INT DEFAULT 0,
  wins INT DEFAULT 0,
  losses INT DEFAULT 0,
  ties INT DEFAULT 0,
  league_avg_wins INT DEFAULT 0,
  league_avg_losses INT DEFAULT 0,
  league_avg_ties INT DEFAULT 0,
  avg_daily_score NUMERIC(10,2) DEFAULT 0,
  total_score NUMERIC(10,2) DEFAULT 0,
  days_played INT DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(event_id, team_id)
);

-- ============================================================
-- PLAYOFF BRACKET
-- ============================================================
CREATE TABLE public.playoff_bracket (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  event_id UUID REFERENCES public.events(id) ON DELETE CASCADE,
  round_number INT NOT NULL, -- 1 = first round, 2 = quarters, etc.
  match_number INT NOT NULL,
  team1_id UUID REFERENCES public.teams(id),
  team2_id UUID REFERENCES public.teams(id),
  team1_score NUMERIC(10,2),
  team2_score NUMERIC(10,2),
  winner_id UUID REFERENCES public.teams(id),
  is_bye BOOLEAN DEFAULT FALSE,
  next_match_id UUID REFERENCES public.playoff_bracket(id),
  day_number INT, -- which competition day this playoff match falls on
  is_finalized BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.divisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schedule ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.score_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matchup_outcomes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.league_average_outcomes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.standings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.playoff_bracket ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_event_assignments ENABLE ROW LEVEL SECURITY;

-- Public read for scoreboard/schedule/standings/bracket
CREATE POLICY "Public read events" ON public.events FOR SELECT USING (true);
CREATE POLICY "Public read divisions" ON public.divisions FOR SELECT USING (true);
CREATE POLICY "Public read teams" ON public.teams FOR SELECT USING (true);
CREATE POLICY "Public read schedule" ON public.schedule FOR SELECT USING (true);
CREATE POLICY "Public read standings" ON public.standings FOR SELECT USING (true);
CREATE POLICY "Public read matchup outcomes" ON public.matchup_outcomes FOR SELECT USING (true);
CREATE POLICY "Public read league avg outcomes" ON public.league_average_outcomes FOR SELECT USING (true);
CREATE POLICY "Public read playoff bracket" ON public.playoff_bracket FOR SELECT USING (true);
CREATE POLICY "Public read categories" ON public.categories FOR SELECT USING (true);
CREATE POLICY "Public read daily scores" ON public.daily_scores FOR SELECT USING (true);

-- Profiles: users can read their own
CREATE POLICY "Users read own profile" ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Super admin read all profiles" ON public.profiles FOR SELECT 
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'super_admin'));

-- Event runners: manage their own events
CREATE POLICY "Event runner manage own events" ON public.events FOR ALL
  USING (created_by = auth.uid());

-- Event runners: manage divisions/teams/categories/schedule for their events
CREATE POLICY "Event runner manage divisions" ON public.divisions FOR ALL
  USING (EXISTS (SELECT 1 FROM public.events WHERE id = event_id AND created_by = auth.uid()));

CREATE POLICY "Event runner manage teams" ON public.teams FOR ALL
  USING (EXISTS (SELECT 1 FROM public.events WHERE id = event_id AND created_by = auth.uid()));

CREATE POLICY "Event runner manage categories" ON public.categories FOR ALL
  USING (EXISTS (SELECT 1 FROM public.events WHERE id = event_id AND created_by = auth.uid()));

CREATE POLICY "Event runner manage schedule" ON public.schedule FOR ALL
  USING (EXISTS (SELECT 1 FROM public.events WHERE id = event_id AND created_by = auth.uid()));

-- Scorers and event runners: can write scores for assigned events
CREATE POLICY "Scorer insert daily scores" ON public.daily_scores FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.user_event_assignments 
      WHERE user_id = auth.uid() AND event_id = daily_scores.event_id
    )
    OR
    EXISTS (
      SELECT 1 FROM public.events WHERE id = event_id AND created_by = auth.uid()
    )
  );

CREATE POLICY "Scorer insert score entries" ON public.score_entries FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.daily_scores ds
      JOIN public.user_event_assignments uea ON uea.event_id = ds.event_id
      WHERE ds.id = daily_score_id AND uea.user_id = auth.uid()
    )
    OR
    EXISTS (
      SELECT 1 FROM public.daily_scores ds
      JOIN public.events e ON e.id = ds.event_id
      WHERE ds.id = daily_score_id AND e.created_by = auth.uid()
    )
  );

-- Matchup outcomes: event runner can write
CREATE POLICY "Event runner manage outcomes" ON public.matchup_outcomes FOR ALL
  USING (EXISTS (SELECT 1 FROM public.events WHERE id = event_id AND created_by = auth.uid()));

CREATE POLICY "Event runner manage league avg" ON public.league_average_outcomes FOR ALL
  USING (EXISTS (SELECT 1 FROM public.events WHERE id = event_id AND created_by = auth.uid()));

CREATE POLICY "Event runner manage standings" ON public.standings FOR ALL
  USING (EXISTS (SELECT 1 FROM public.events WHERE id = event_id AND created_by = auth.uid()));

CREATE POLICY "Event runner manage bracket" ON public.playoff_bracket FOR ALL
  USING (EXISTS (SELECT 1 FROM public.events WHERE id = event_id AND created_by = auth.uid()));

-- User event assignments
CREATE POLICY "Event runner manage assignments" ON public.user_event_assignments FOR ALL
  USING (EXISTS (SELECT 1 FROM public.events WHERE id = event_id AND created_by = auth.uid()));

CREATE POLICY "Scorer read own assignments" ON public.user_event_assignments FOR SELECT
  USING (user_id = auth.uid());

-- ============================================================
-- TRIGGER: auto-create profile on signup
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, role)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'role', 'scorer'));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
