export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      activity_log: {
        Row: {
          created_at: string
          group_id: string | null
          id: string
          kind: string
          level: string
          message: string
          meta: Json
        }
        Insert: {
          created_at?: string
          group_id?: string | null
          id?: string
          kind: string
          level?: string
          message: string
          meta?: Json
        }
        Update: {
          created_at?: string
          group_id?: string | null
          id?: string
          kind?: string
          level?: string
          message?: string
          meta?: Json
        }
        Relationships: [
          {
            foreignKeyName: "activity_log_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
        ]
      }
      content_pieces: {
        Row: {
          body: string
          created_at: string
          hook: string | null
          id: string
          kind: string
          opportunity_id: string | null
          status: string
          updated_at: string
          variant_label: string | null
        }
        Insert: {
          body: string
          created_at?: string
          hook?: string | null
          id?: string
          kind?: string
          opportunity_id?: string | null
          status?: string
          updated_at?: string
          variant_label?: string | null
        }
        Update: {
          body?: string
          created_at?: string
          hook?: string | null
          id?: string
          kind?: string
          opportunity_id?: string | null
          status?: string
          updated_at?: string
          variant_label?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "content_pieces_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
        ]
      }
      content_templates: {
        Row: {
          body: string
          created_at: string
          id: string
          kind: string
          name: string
          notes: string | null
          updated_at: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          kind?: string
          name: string
          notes?: string | null
          updated_at?: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          kind?: string
          name?: string
          notes?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      folders: {
        Row: {
          color: string
          created_at: string
          id: string
          name: string
        }
        Insert: {
          color?: string
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          color?: string
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      groups: {
        Row: {
          activity_level: string
          can_post: boolean
          created_at: string
          enabled: boolean
          engagement_score: number
          fb_group_id: string | null
          folder_id: string | null
          health: string
          id: string
          last_scanned_at: string | null
          member_count: number | null
          name: string
          notes: string | null
          updated_at: string
          url: string
        }
        Insert: {
          activity_level?: string
          can_post?: boolean
          created_at?: string
          enabled?: boolean
          engagement_score?: number
          fb_group_id?: string | null
          folder_id?: string | null
          health?: string
          id?: string
          last_scanned_at?: string | null
          member_count?: number | null
          name: string
          notes?: string | null
          updated_at?: string
          url: string
        }
        Update: {
          activity_level?: string
          can_post?: boolean
          created_at?: string
          enabled?: boolean
          engagement_score?: number
          fb_group_id?: string | null
          folder_id?: string | null
          health?: string
          id?: string
          last_scanned_at?: string | null
          member_count?: number | null
          name?: string
          notes?: string | null
          updated_at?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "groups_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "folders"
            referencedColumns: ["id"]
          },
        ]
      }
      opportunities: {
        Row: {
          audience: string | null
          buying_intent: number
          confidence: number
          created_at: string
          demand_score: number
          frequency: number
          id: string
          keywords: string[]
          niche: string | null
          pain_point: string | null
          recommended_products: Json
          status: string
          summary: string | null
          title: string
          trend: string
          updated_at: string
          urgency: number
          why_it_matters: string | null
        }
        Insert: {
          audience?: string | null
          buying_intent?: number
          confidence?: number
          created_at?: string
          demand_score?: number
          frequency?: number
          id?: string
          keywords?: string[]
          niche?: string | null
          pain_point?: string | null
          recommended_products?: Json
          status?: string
          summary?: string | null
          title: string
          trend?: string
          updated_at?: string
          urgency?: number
          why_it_matters?: string | null
        }
        Update: {
          audience?: string | null
          buying_intent?: number
          confidence?: number
          created_at?: string
          demand_score?: number
          frequency?: number
          id?: string
          keywords?: string[]
          niche?: string | null
          pain_point?: string | null
          recommended_products?: Json
          status?: string
          summary?: string | null
          title?: string
          trend?: string
          updated_at?: string
          urgency?: number
          why_it_matters?: string | null
        }
        Relationships: []
      }
      opportunity_posts: {
        Row: {
          opportunity_id: string
          post_id: string
        }
        Insert: {
          opportunity_id: string
          post_id: string
        }
        Update: {
          opportunity_id?: string
          post_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "opportunity_posts_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunity_posts_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
        ]
      }
      post_insights: {
        Row: {
          audience_type: string | null
          buying_intent: number
          confidence: number
          created_at: string
          desired_outcome: string | null
          frustrations: string[]
          id: string
          niche: string | null
          objections: string[]
          pain_point: string | null
          post_id: string
          sentiment: string | null
          topics: string[]
          urgency: number
        }
        Insert: {
          audience_type?: string | null
          buying_intent?: number
          confidence?: number
          created_at?: string
          desired_outcome?: string | null
          frustrations?: string[]
          id?: string
          niche?: string | null
          objections?: string[]
          pain_point?: string | null
          post_id: string
          sentiment?: string | null
          topics?: string[]
          urgency?: number
        }
        Update: {
          audience_type?: string | null
          buying_intent?: number
          confidence?: number
          created_at?: string
          desired_outcome?: string | null
          frustrations?: string[]
          id?: string
          niche?: string | null
          objections?: string[]
          pain_point?: string | null
          post_id?: string
          sentiment?: string | null
          topics?: string[]
          urgency?: number
        }
        Relationships: [
          {
            foreignKeyName: "post_insights_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: true
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
        ]
      }
      posts: {
        Row: {
          analyzed_at: string | null
          author_name: string | null
          comments_count: number
          content: string
          content_hash: string
          fb_post_id: string | null
          group_id: string | null
          id: string
          permalink: string | null
          posted_at: string | null
          raw: Json | null
          reactions: number
          scraped_at: string
          shares: number
          top_comments: Json
        }
        Insert: {
          analyzed_at?: string | null
          author_name?: string | null
          comments_count?: number
          content: string
          content_hash: string
          fb_post_id?: string | null
          group_id?: string | null
          id?: string
          permalink?: string | null
          posted_at?: string | null
          raw?: Json | null
          reactions?: number
          scraped_at?: string
          shares?: number
          top_comments?: Json
        }
        Update: {
          analyzed_at?: string | null
          author_name?: string | null
          comments_count?: number
          content?: string
          content_hash?: string
          fb_post_id?: string | null
          group_id?: string | null
          id?: string
          permalink?: string | null
          posted_at?: string | null
          raw?: Json | null
          reactions?: number
          scraped_at?: string
          shares?: number
          top_comments?: Json
        }
        Relationships: [
          {
            foreignKeyName: "posts_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
        ]
      }
      scheduled_posts: {
        Row: {
          attempts: number
          claimed_at: string | null
          content_piece_id: string
          created_at: string
          error: string | null
          group_id: string
          id: string
          published_at: string | null
          result_url: string | null
          scheduled_for: string
          status: string
        }
        Insert: {
          attempts?: number
          claimed_at?: string | null
          content_piece_id: string
          created_at?: string
          error?: string | null
          group_id: string
          id?: string
          published_at?: string | null
          result_url?: string | null
          scheduled_for: string
          status?: string
        }
        Update: {
          attempts?: number
          claimed_at?: string | null
          content_piece_id?: string
          created_at?: string
          error?: string | null
          group_id?: string
          id?: string
          published_at?: string | null
          result_url?: string | null
          scheduled_for?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "scheduled_posts_content_piece_id_fkey"
            columns: ["content_piece_id"]
            isOneToOne: false
            referencedRelation: "content_pieces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_posts_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
        ]
      }
      settings: {
        Row: {
          allow_repost_same_content: boolean
          auto_publish: boolean
          chrome_status: string
          created_at: string
          daily_post_limit: number
          fb_account_name: string | null
          id: boolean
          job_lease_minutes: number
          last_heartbeat_at: string | null
          last_publish_at: string | null
          last_scan_at: string | null
          last_sync_at: string | null
          max_delay_seconds: number
          max_groups_per_cycle: number
          max_job_attempts: number
          min_delay_seconds: number
          pending_command: string | null
          pending_command_at: string | null
          quiet_hours_end: number
          quiet_hours_start: number
          randomization_window_minutes: number
          scan_interval_hours: number
          scans_per_hour: number
          session_expires_at: string | null
          session_status: string
          session_validated_at: string | null
          timezone: string
          updated_at: string
          window_end_hour: number
          window_start_hour: number
          worker_paused: boolean
          worker_token: string
          worker_version: string | null
        }
        Insert: {
          allow_repost_same_content?: boolean
          auto_publish?: boolean
          chrome_status?: string
          created_at?: string
          daily_post_limit?: number
          fb_account_name?: string | null
          id?: boolean
          job_lease_minutes?: number
          last_heartbeat_at?: string | null
          last_publish_at?: string | null
          last_scan_at?: string | null
          last_sync_at?: string | null
          max_delay_seconds?: number
          max_groups_per_cycle?: number
          max_job_attempts?: number
          min_delay_seconds?: number
          pending_command?: string | null
          pending_command_at?: string | null
          quiet_hours_end?: number
          quiet_hours_start?: number
          randomization_window_minutes?: number
          scan_interval_hours?: number
          scans_per_hour?: number
          session_expires_at?: string | null
          session_status?: string
          session_validated_at?: string | null
          timezone?: string
          updated_at?: string
          window_end_hour?: number
          window_start_hour?: number
          worker_paused?: boolean
          worker_token?: string
          worker_version?: string | null
        }
        Update: {
          allow_repost_same_content?: boolean
          auto_publish?: boolean
          chrome_status?: string
          created_at?: string
          daily_post_limit?: number
          fb_account_name?: string | null
          id?: boolean
          job_lease_minutes?: number
          last_heartbeat_at?: string | null
          last_publish_at?: string | null
          last_scan_at?: string | null
          last_sync_at?: string | null
          max_delay_seconds?: number
          max_groups_per_cycle?: number
          max_job_attempts?: number
          min_delay_seconds?: number
          pending_command?: string | null
          pending_command_at?: string | null
          quiet_hours_end?: number
          quiet_hours_start?: number
          randomization_window_minutes?: number
          scan_interval_hours?: number
          scans_per_hour?: number
          session_expires_at?: string | null
          session_status?: string
          session_validated_at?: string | null
          timezone?: string
          updated_at?: string
          window_end_hour?: number
          window_start_hour?: number
          worker_paused?: boolean
          worker_token?: string
          worker_version?: string | null
        }
        Relationships: []
      }
      worker_jobs: {
        Row: {
          attempts: number
          claimed_at: string | null
          completed_at: string | null
          created_at: string
          error: string | null
          group_id: string | null
          id: string
          lease_expires_at: string | null
          payload: Json
          priority: number
          result: Json | null
          scheduled_for: string
          status: string
          type: string
        }
        Insert: {
          attempts?: number
          claimed_at?: string | null
          completed_at?: string | null
          created_at?: string
          error?: string | null
          group_id?: string | null
          id?: string
          lease_expires_at?: string | null
          payload?: Json
          priority?: number
          result?: Json | null
          scheduled_for?: string
          status?: string
          type: string
        }
        Update: {
          attempts?: number
          claimed_at?: string | null
          completed_at?: string | null
          created_at?: string
          error?: string | null
          group_id?: string | null
          id?: string
          lease_expires_at?: string | null
          payload?: Json
          priority?: number
          result?: Json | null
          scheduled_for?: string
          status?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "worker_jobs_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
