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
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      access_keys: {
        Row: {
          created_at: string
          expires_at: string | null
          id: string
          is_active: boolean
          is_admin: boolean
          key: string
          label: string | null
          usage_count: number
        }
        Insert: {
          created_at?: string
          expires_at?: string | null
          id?: string
          is_active?: boolean
          is_admin?: boolean
          key: string
          label?: string | null
          usage_count?: number
        }
        Update: {
          created_at?: string
          expires_at?: string | null
          id?: string
          is_active?: boolean
          is_admin?: boolean
          key?: string
          label?: string | null
          usage_count?: number
        }
        Relationships: []
      }
      check_logs: {
        Row: {
          access_key: string
          amount: string | null
          bin: string | null
          brand: string | null
          card_masked: string
          code: string | null
          created_at: string
          id: string
          merchant: string | null
          message: string | null
          mode: string | null
          provider: string | null
          response_time: number | null
          status: string
        }
        Insert: {
          access_key: string
          amount?: string | null
          bin?: string | null
          brand?: string | null
          card_masked: string
          code?: string | null
          created_at?: string
          id?: string
          merchant?: string | null
          message?: string | null
          mode?: string | null
          provider?: string | null
          response_time?: number | null
          status: string
        }
        Update: {
          access_key?: string
          amount?: string | null
          bin?: string | null
          brand?: string | null
          card_masked?: string
          code?: string | null
          created_at?: string
          id?: string
          merchant?: string | null
          message?: string | null
          mode?: string | null
          provider?: string | null
          response_time?: number | null
          status?: string
        }
        Relationships: []
      }
      custom_gates: {
        Row: {
          amount: string | null
          client_secret: string | null
          created_at: string
          created_by: string
          currency: string | null
          id: string
          is_active: boolean
          merchant: string | null
          name: string
          product: string | null
          provider: string
          site_url: string
          stripe_pk: string | null
          updated_at: string
        }
        Insert: {
          amount?: string | null
          client_secret?: string | null
          created_at?: string
          created_by: string
          currency?: string | null
          id?: string
          is_active?: boolean
          merchant?: string | null
          name: string
          product?: string | null
          provider?: string
          site_url: string
          stripe_pk?: string | null
          updated_at?: string
        }
        Update: {
          amount?: string | null
          client_secret?: string | null
          created_at?: string
          created_by?: string
          currency?: string | null
          id?: string
          is_active?: boolean
          merchant?: string | null
          name?: string
          product?: string | null
          provider?: string
          site_url?: string
          stripe_pk?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      promos_unchecked: {
        Row: {
          code: string
          created_at: string
          discord_user_id: string | null
          id: string
          pulled_by: string | null
          source_email: string | null
          status: string | null
          title: string | null
        }
        Insert: {
          code: string
          created_at?: string
          discord_user_id?: string | null
          id?: string
          pulled_by?: string | null
          source_email?: string | null
          status?: string | null
          title?: string | null
        }
        Update: {
          code?: string
          created_at?: string
          discord_user_id?: string | null
          id?: string
          pulled_by?: string | null
          source_email?: string | null
          status?: string | null
          title?: string | null
        }
        Relationships: []
      }
      proxies: {
        Row: {
          created_at: string
          fail_count: number
          id: string
          is_active: boolean
          last_checked: string | null
          last_status: string | null
          protocol: string
          proxy: string
          success_count: number
        }
        Insert: {
          created_at?: string
          fail_count?: number
          id?: string
          is_active?: boolean
          last_checked?: string | null
          last_status?: string | null
          protocol?: string
          proxy: string
          success_count?: number
        }
        Update: {
          created_at?: string
          fail_count?: number
          id?: string
          is_active?: boolean
          last_checked?: string | null
          last_status?: string | null
          protocol?: string
          proxy?: string
          success_count?: number
        }
        Relationships: []
      }
      scraped_sites: {
        Row: {
          category_id: string | null
          client_secret: string | null
          created_at: string
          domain: string
          gateway_details: Json | null
          id: string
          last_checked: string | null
          notes: string | null
          payment_gateway: string | null
          requires_login: boolean | null
          requires_phone: boolean | null
          status: string
          stripe_pk: string | null
          telegram_notified: boolean
          updated_at: string
          url: string
        }
        Insert: {
          category_id?: string | null
          client_secret?: string | null
          created_at?: string
          domain: string
          gateway_details?: Json | null
          id?: string
          last_checked?: string | null
          notes?: string | null
          payment_gateway?: string | null
          requires_login?: boolean | null
          requires_phone?: boolean | null
          status?: string
          stripe_pk?: string | null
          telegram_notified?: boolean
          updated_at?: string
          url: string
        }
        Update: {
          category_id?: string | null
          client_secret?: string | null
          created_at?: string
          domain?: string
          gateway_details?: Json | null
          id?: string
          last_checked?: string | null
          notes?: string | null
          payment_gateway?: string | null
          requires_login?: boolean | null
          requires_phone?: boolean | null
          status?: string
          stripe_pk?: string | null
          telegram_notified?: boolean
          updated_at?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "scraped_sites_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "scraper_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      scraper_categories: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          search_queries: string[]
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          search_queries?: string[]
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          search_queries?: string[]
        }
        Relationships: []
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
