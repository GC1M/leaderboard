
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "daily_metrics": {
                  Row: {
                    "health_device_id": string | null,
                    "date": string,"metric": string,"source": string,"updated_at": string,"user_id": string,"value": number,"window_end": string | null,"window_start": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "health_device_id"?: string | null,
                    "date": string,"metric": string,"source": string,"updated_at"?: string,"user_id": string,"value": number,"window_end"?: string | null,"window_start"?: string | null
                  }
                  Update: {
                    "health_device_id"?: string | null,
                    "date"?: string,"metric"?: string,"source"?: string,"updated_at"?: string,"user_id"?: string,"value"?: number,"window_end"?: string | null,"window_start"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "daily_metrics_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"goals": {
                  Row: {
                    "end_date": string | null,"id": string,"metric": string,"start_date": string,"start_value": number,"target_value": number,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "end_date"?: string | null,"id"?: string,"metric": string,"start_date": string,"start_value": number,"target_value": number,"user_id": string
                  }
                  Update: {
                    "end_date"?: string | null,"id"?: string,"metric"?: string,"start_date"?: string,"start_value"?: number,"target_value"?: number,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "goals_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"group_members": {
                  Row: {
                    "group_id": string,"joined_at": string,"role": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "group_id": string,"joined_at"?: string,"role"?: string,"user_id": string
                  }
                  Update: {
                    "group_id"?: string,"joined_at"?: string,"role"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "group_members_group_id_fkey"
      columns: ["group_id"]
isOneToOne: false
      referencedRelation: "groups"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "group_members_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"groups": {
                  Row: {
                    "created_at": string,"id": string,"invite_code": string,"name": string,"owner_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"invite_code"?: string,"name": string,"owner_id": string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"invite_code"?: string,"name"?: string,"owner_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "groups_owner_id_fkey"
      columns: ["owner_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"metric_shares": {
                  Row: {
                    "created_at": string,"group_id": string,"metric": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"group_id": string,"metric": string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"group_id"?: string,"metric"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "metric_shares_group_id_user_id_fkey"
      columns: ["group_id","user_id"]
isOneToOne: false
      referencedRelation: "group_members"
      referencedColumns: ["group_id","user_id"]
    }
                  ]
                },"profiles": {
                  Row: {
                    "avatar_url": string | null,"created_at": string,"display_name": string,"id": string,"timezone": string
                  }
                  ComputedFields: never
                  Insert: {
                    "avatar_url"?: string | null,"created_at"?: string,"display_name": string,"id": string,"timezone"?: string
                  }
                  Update: {
                    "avatar_url"?: string | null,"created_at"?: string,"display_name"?: string,"id"?: string,"timezone"?: string
                  }
                  Relationships: [
                    
                  ]
                },"weight_measurements": {
                  Row: {
                    "health_device_id": string | null,
                    "id": string,"kg": number,"measured_at": string,"source": string,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "health_device_id"?: string | null,
                    "id"?: string,"kg": number,"measured_at": string,"source": string,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "health_device_id"?: string | null,
                    "id"?: string,"kg"?: number,"measured_at"?: string,"source"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "weight_measurements_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            "latest_weight": {
                  Row: {
                    "kg": number,"measured_at": string,"source": string,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Relationships: [
                    {
      foreignKeyName: "weight_measurements_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Functions: {
            "apply_health_changes": { Args: { p_owner: string; p_device: string; p_metric: string; p_daily: Json; p_remove_daily: string[]; p_weight: Json; p_remove_weight: string[] }; Returns: undefined },
            "create_group":
{ Args: { "name": string }; Returns: {
              "created_at": string,
"id": string,
"invite_code": string,
"name": string,
"owner_id": string
            }
                          SetofOptions: {
        from: "*"
        to: "groups"
        isOneToOne: true
        isSetofReturn: false
      } },
"delete_member_manual_entry":
{ Args: { "p_group_id": string,"p_metric": string,"p_user_id": string }; Returns: undefined
                           },
"delete_my_account":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"delete_my_health_imports":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"gen_invite_code":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"group_latest_weight":
{ Args: { "p_group_id": string }; Returns: {
              "kg": number,"measured_on": string,"user_id": string
            }[]
                           },
"group_leaderboard":
{ Args: { "p_group_id": string,"p_metric": string,"p_period": string }; Returns: {
              "display_name": string,"rank": number,"state": string,"user_id": string,"value": number
            }[]
                           },
"group_sleep":
{ Args: { "p_from": string,"p_group_id": string,"p_to": string }; Returns: {
              "date": string,"minutes": number,"user_id": string
            }[]
                           },
"group_steps":
{ Args: { "p_from": string,"p_group_id": string,"p_to": string }; Returns: {
              "date": string,"source": string,"steps": number,"user_id": string
            }[]
                           },
"is_group_member":
{ Args: { "p_group_id": string }; Returns: boolean
                           },
"join_group":
{ Args: { "code": string }; Returns: string
                           },
"remove_member":
{ Args: { "p_group_id": string,"p_user_id": string }; Returns: undefined
                           },
"shares_group_with":
{ Args: { "p_user_id": string }; Returns: boolean
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            
          }
        }
} as const
