export type Project = {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  user_id: string;
};

export type Signal = {
  id: string;
  project_id: string | null;
  user_id: string;
  highlight_text: string;
  source_url: string | null;
  source_title: string | null;
  signal_summary: string | null;
  connected_to: string | null;
  created_at: string;
};

export type TaskContext = {
  id: string;
  user_id: string;
  task_description: string;
  email_thread_text: string | null;
  active: boolean;
  created_at: string;
};

export type KnowledgeNote = {
  id: string;
  user_id: string;
  content: string;
  tags: string[] | null;
  source_url: string | null;
  created_at: string;
};

export type RadarType = "news" | "longread" | "paper" | "report";

export type RadarItem = {
  id: string;
  user_id: string;
  headline: string;
  url: string;
  source: string | null;
  published_date: string | null;
  type: RadarType | null;
  why_read: string | null;
  relevance_score: number | null;
  novelty_score: number | null;
  actionability_score: number | null;
  interest_vector: string | null;
  dismissed: boolean;
  saved_to_project_id: string | null;
  created_at: string;
};

export type InterestVector = {
  id: string;
  user_id: string;
  vector_text: string;
  source: "auto" | "manual";
  active: boolean;
  created_at: string;
};
