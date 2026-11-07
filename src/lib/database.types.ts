
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
            "competition_audit": {
                  Row: {
                    "actor_id": string | null,"competition_id": string,"created_at": string,"event": string,"id": string,"reason": string | null,"target_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "actor_id"?: string | null,"competition_id": string,"created_at"?: string,"event": string,"id"?: string,"reason"?: string | null,"target_id"?: string | null
                  }
                  Update: {
                    "actor_id"?: string | null,"competition_id"?: string,"created_at"?: string,"event"?: string,"id"?: string,"reason"?: string | null,"target_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "competition_audit_actor_id_fkey"
      columns: ["actor_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "competition_audit_competition_id_fkey"
      columns: ["competition_id"]
isOneToOne: false
      referencedRelation: "competitions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "competition_audit_target_id_fkey"
      columns: ["target_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"competition_participants": {
                  Row: {
                    "competition_id": string,"departed_at": string | null,"joined_at": string,"status": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "competition_id": string,"departed_at"?: string | null,"joined_at"?: string,"status"?: string,"user_id": string
                  }
                  Update: {
                    "competition_id"?: string,"departed_at"?: string | null,"joined_at"?: string,"status"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "competition_participants_competition_id_fkey"
      columns: ["competition_id"]
isOneToOne: false
      referencedRelation: "competitions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "competition_participants_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"competition_results": {
                  Row: {
                    "competition_id": string,"eligibility": string,"excluded_entries": number,"health_entries": number,"manual_entries": number,"score": number | null,"updated_at": string | null,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "competition_id": string,"eligibility": string,"excluded_entries": number,"health_entries": number,"manual_entries": number,"score"?: number | null,"updated_at"?: string | null,"user_id": string
                  }
                  Update: {
                    "competition_id"?: string,"eligibility"?: string,"excluded_entries"?: number,"health_entries"?: number,"manual_entries"?: number,"score"?: number | null,"updated_at"?: string | null,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "competition_results_competition_id_user_id_fkey"
      columns: ["competition_id","user_id"]
isOneToOne: true
      referencedRelation: "competition_participants"
      referencedColumns: ["competition_id","user_id"]
    }
                  ]
                },"competition_rules": {
                  Row: {
                    "rules": NonNullable<Json>,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "rules": NonNullable<Json>,"version": number
                  }
                  Update: {
                    "rules"?: NonNullable<Json>,"version"?: number
                  }
                  Relationships: [
                    
                  ]
                },"competitions": {
                  Row: {
                    "cancelled_at": string | null,"created_at": string,"creator_id": string | null,"ends_at": string,"finalized_at": string | null,"group_id": string,"id": string,"include_manual": boolean,"metric": string,"name": string,"scoring_version": number,"starts_at": string,"status": string,"timezone": string
                  }
                  ComputedFields: never
                  Insert: {
                    "cancelled_at"?: string | null,"created_at"?: string,"creator_id"?: string | null,"ends_at": string,"finalized_at"?: string | null,"group_id": string,"id"?: string,"include_manual"?: boolean,"metric": string,"name": string,"scoring_version"?: number,"starts_at": string,"status"?: string,"timezone": string
                  }
                  Update: {
                    "cancelled_at"?: string | null,"created_at"?: string,"creator_id"?: string | null,"ends_at"?: string,"finalized_at"?: string | null,"group_id"?: string,"id"?: string,"include_manual"?: boolean,"metric"?: string,"name"?: string,"scoring_version"?: number,"starts_at"?: string,"status"?: string,"timezone"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "competitions_creator_id_fkey"
      columns: ["creator_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "competitions_group_id_fkey"
      columns: ["group_id"]
isOneToOne: false
      referencedRelation: "groups"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "competitions_scoring_version_fkey"
      columns: ["scoring_version"]
isOneToOne: false
      referencedRelation: "competition_rules"
      referencedColumns: ["version"]
    }
                  ]
                },"daily_metrics": {
                  Row: {
                    "date": string,"health_device_id": string | null,"metric": string,"source": string,"updated_at": string,"user_id": string,"value": number,"window_end": string | null,"window_start": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "date": string,"health_device_id"?: string | null,"metric": string,"source": string,"updated_at"?: string,"user_id": string,"value": number,"window_end"?: string | null,"window_start"?: string | null
                  }
                  Update: {
                    "date"?: string,"health_device_id"?: string | null,"metric"?: string,"source"?: string,"updated_at"?: string,"user_id"?: string,"value"?: number,"window_end"?: string | null,"window_start"?: string | null
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
                },"exercises": {
                  Row: {
                    "category": string,"id": string,"name": string,"updated_at": string,"user_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "category": string,"id"?: string,"name": string,"updated_at"?: string,"user_id"?: string | null
                  }
                  Update: {
                    "category"?: string,"id"?: string,"name"?: string,"updated_at"?: string,"user_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "exercises_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"food_entries": {
                  Row: {
                    "carbs_g": number | null,"client_id": string,"consumed_at": string,"created_at": string,"energy_kcal": number | null,"fat_g": number | null,"fiber_g": number | null,"food_brand": string | null,"food_id": string | null,"food_name": string,"grams": number,"id": string,"is_estimated": boolean,"local_date": string,"meal": string,"portion_count": number | null,"portion_label": string | null,"protein_g": number | null,"provider": string,"provider_id": string | null,"sat_fat_g": number | null,"sodium_mg": number | null,"source_data_type": string | null,"source_version": string | null,"sugars_g": number | null,"timezone": string,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "carbs_g"?: number | null,"client_id": string,"consumed_at": string,"created_at"?: string,"energy_kcal"?: number | null,"fat_g"?: number | null,"fiber_g"?: number | null,"food_brand"?: string | null,"food_id"?: string | null,"food_name": string,"grams": number,"id"?: string,"is_estimated"?: boolean,"local_date"?: string,"meal": string,"portion_count"?: number | null,"portion_label"?: string | null,"protein_g"?: number | null,"provider": string,"provider_id"?: string | null,"sat_fat_g"?: number | null,"sodium_mg"?: number | null,"source_data_type"?: string | null,"source_version"?: string | null,"sugars_g"?: number | null,"timezone": string,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "carbs_g"?: number | null,"client_id"?: string,"consumed_at"?: string,"created_at"?: string,"energy_kcal"?: number | null,"fat_g"?: number | null,"fiber_g"?: number | null,"food_brand"?: string | null,"food_id"?: string | null,"food_name"?: string,"grams"?: number,"id"?: string,"is_estimated"?: boolean,"local_date"?: string,"meal"?: string,"portion_count"?: number | null,"portion_label"?: string | null,"protein_g"?: number | null,"provider"?: string,"provider_id"?: string | null,"sat_fat_g"?: number | null,"sodium_mg"?: number | null,"source_data_type"?: string | null,"source_version"?: string | null,"sugars_g"?: number | null,"timezone"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "food_entries_food_id_fkey"
      columns: ["food_id"]
isOneToOne: false
      referencedRelation: "foods"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "food_entries_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"food_portions": {
                  Row: {
                    "food_id": string,"gram_weight": number,"id": string,"label": string
                  }
                  ComputedFields: never
                  Insert: {
                    "food_id": string,"gram_weight": number,"id"?: string,"label": string
                  }
                  Update: {
                    "food_id"?: string,"gram_weight"?: number,"id"?: string,"label"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "food_portions_food_id_fkey"
      columns: ["food_id"]
isOneToOne: false
      referencedRelation: "foods"
      referencedColumns: ["id"]
    }
                  ]
                },"food_recipe_ingredients": {
                  Row: {
                    "carbs_g": number | null,"energy_kcal": number | null,"fat_g": number | null,"fiber_g": number | null,"food_id": string | null,"food_name": string,"grams": number,"id": string,"position": number,"protein_g": number | null,"recipe_id": string,"sat_fat_g": number | null,"sodium_mg": number | null,"sugars_g": number | null
                  }
                  ComputedFields: never
                  Insert: {
                    "carbs_g"?: number | null,"energy_kcal"?: number | null,"fat_g"?: number | null,"fiber_g"?: number | null,"food_id"?: string | null,"food_name": string,"grams": number,"id"?: string,"position": number,"protein_g"?: number | null,"recipe_id": string,"sat_fat_g"?: number | null,"sodium_mg"?: number | null,"sugars_g"?: number | null
                  }
                  Update: {
                    "carbs_g"?: number | null,"energy_kcal"?: number | null,"fat_g"?: number | null,"fiber_g"?: number | null,"food_id"?: string | null,"food_name"?: string,"grams"?: number,"id"?: string,"position"?: number,"protein_g"?: number | null,"recipe_id"?: string,"sat_fat_g"?: number | null,"sodium_mg"?: number | null,"sugars_g"?: number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "food_recipe_ingredients_food_id_fkey"
      columns: ["food_id"]
isOneToOne: false
      referencedRelation: "foods"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "food_recipe_ingredients_recipe_id_fkey"
      columns: ["recipe_id"]
isOneToOne: false
      referencedRelation: "food_recipes"
      referencedColumns: ["id"]
    }
                  ]
                },"food_recipes": {
                  Row: {
                    "id": string,"name": string,"notes": string | null,"servings": number,"updated_at": string,"user_id": string,"yield_g": number | null
                  }
                  ComputedFields: never
                  Insert: {
                    "id"?: string,"name": string,"notes"?: string | null,"servings"?: number,"updated_at"?: string,"user_id": string,"yield_g"?: number | null
                  }
                  Update: {
                    "id"?: string,"name"?: string,"notes"?: string | null,"servings"?: number,"updated_at"?: string,"user_id"?: string,"yield_g"?: number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "food_recipes_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"food_search_log": {
                  Row: {
                    "searched_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "searched_at"?: string,"user_id": string
                  }
                  Update: {
                    "searched_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "food_search_log_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"foods": {
                  Row: {
                    "brand": string | null,"carbs_g": number | null,"energy_kcal": number | null,"fat_g": number | null,"fiber_g": number | null,"id": string,"name": string,"protein_g": number | null,"provider": string,"provider_id": string | null,"sat_fat_g": number | null,"sodium_mg": number | null,"source_data_type": string | null,"source_version": string | null,"sugars_g": number | null,"updated_at": string,"user_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "brand"?: string | null,"carbs_g"?: number | null,"energy_kcal"?: number | null,"fat_g"?: number | null,"fiber_g"?: number | null,"id"?: string,"name": string,"protein_g"?: number | null,"provider": string,"provider_id"?: string | null,"sat_fat_g"?: number | null,"sodium_mg"?: number | null,"source_data_type"?: string | null,"source_version"?: string | null,"sugars_g"?: number | null,"updated_at"?: string,"user_id"?: string | null
                  }
                  Update: {
                    "brand"?: string | null,"carbs_g"?: number | null,"energy_kcal"?: number | null,"fat_g"?: number | null,"fiber_g"?: number | null,"id"?: string,"name"?: string,"protein_g"?: number | null,"provider"?: string,"provider_id"?: string | null,"sat_fat_g"?: number | null,"sodium_mg"?: number | null,"source_data_type"?: string | null,"source_version"?: string | null,"sugars_g"?: number | null,"updated_at"?: string,"user_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "foods_user_id_fkey"
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
                },"health_exports": {
                  Row: {
                    "device_id": string,"kind": string,"record_id": string,"sample_uuid": string | null,"sync_version": number,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "device_id": string,"kind": string,"record_id": string,"sample_uuid"?: string | null,"sync_version": number,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "device_id"?: string,"kind"?: string,"record_id"?: string,"sample_uuid"?: string | null,"sync_version"?: number,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "health_exports_user_id_fkey"
      columns: ["user_id"]
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
                },"water_entries": {
                  Row: {
                    "client_id": string | null,"consumed_at": string,"created_at": string,"health_device_id": string | null,"health_uuid": string | null,"id": string,"local_date": string,"ml": number,"source": string,"source_name": string | null,"timezone": string,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "client_id"?: string | null,"consumed_at": string,"created_at"?: string,"health_device_id"?: string | null,"health_uuid"?: string | null,"id"?: string,"local_date"?: string,"ml": number,"source": string,"source_name"?: string | null,"timezone": string,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "client_id"?: string | null,"consumed_at"?: string,"created_at"?: string,"health_device_id"?: string | null,"health_uuid"?: string | null,"id"?: string,"local_date"?: string,"ml"?: number,"source"?: string,"source_name"?: string | null,"timezone"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "water_entries_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"water_targets": {
                  Row: {
                    "daily_ml": number,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "daily_ml": number,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "daily_ml"?: number,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "water_targets_user_id_fkey"
      columns: ["user_id"]
isOneToOne: true
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"weight_measurements": {
                  Row: {
                    "health_device_id": string | null,"id": string,"kg": number,"measured_at": string,"source": string,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "health_device_id"?: string | null,"id"?: string,"kg": number,"measured_at": string,"source": string,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "health_device_id"?: string | null,"id"?: string,"kg"?: number,"measured_at"?: string,"source"?: string,"updated_at"?: string,"user_id"?: string
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
                },"workout_exercises": {
                  Row: {
                    "exercise_id": string,"id": string,"notes": string | null,"position": number,"workout_id": string,"workout_source": string
                  }
                  ComputedFields: never
                  Insert: {
                    "exercise_id": string,"id"?: string,"notes"?: string | null,"position": number,"workout_id": string,"workout_source"?: string
                  }
                  Update: {
                    "exercise_id"?: string,"id"?: string,"notes"?: string | null,"position"?: number,"workout_id"?: string,"workout_source"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "workout_exercises_exercise_id_fkey"
      columns: ["exercise_id"]
isOneToOne: false
      referencedRelation: "exercises"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "workout_exercises_workout_id_workout_source_fkey"
      columns: ["workout_id","workout_source"]
isOneToOne: false
      referencedRelation: "workouts"
      referencedColumns: ["id","source"]
    }
                  ]
                },"workout_sets": {
                  Row: {
                    "distance_m": number | null,"duration_s": number | null,"id": string,"load_kg": number | null,"position": number,"reps": number | null,"workout_exercise_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "distance_m"?: number | null,"duration_s"?: number | null,"id"?: string,"load_kg"?: number | null,"position": number,"reps"?: number | null,"workout_exercise_id": string
                  }
                  Update: {
                    "distance_m"?: number | null,"duration_s"?: number | null,"id"?: string,"load_kg"?: number | null,"position"?: number,"reps"?: number | null,"workout_exercise_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "workout_sets_workout_exercise_id_fkey"
      columns: ["workout_exercise_id"]
isOneToOne: false
      referencedRelation: "workout_exercises"
      referencedColumns: ["id"]
    }
                  ]
                },"workout_template_exercises": {
                  Row: {
                    "exercise_id": string,"id": string,"notes": string | null,"position": number,"template_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "exercise_id": string,"id"?: string,"notes"?: string | null,"position": number,"template_id": string
                  }
                  Update: {
                    "exercise_id"?: string,"id"?: string,"notes"?: string | null,"position"?: number,"template_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "workout_template_exercises_exercise_id_fkey"
      columns: ["exercise_id"]
isOneToOne: false
      referencedRelation: "exercises"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "workout_template_exercises_template_id_fkey"
      columns: ["template_id"]
isOneToOne: false
      referencedRelation: "workout_templates"
      referencedColumns: ["id"]
    }
                  ]
                },"workout_template_sets": {
                  Row: {
                    "distance_m": number | null,"duration_s": number | null,"id": string,"load_kg": number | null,"position": number,"reps": number | null,"template_exercise_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "distance_m"?: number | null,"duration_s"?: number | null,"id"?: string,"load_kg"?: number | null,"position": number,"reps"?: number | null,"template_exercise_id": string
                  }
                  Update: {
                    "distance_m"?: number | null,"duration_s"?: number | null,"id"?: string,"load_kg"?: number | null,"position"?: number,"reps"?: number | null,"template_exercise_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "workout_template_sets_template_exercise_id_fkey"
      columns: ["template_exercise_id"]
isOneToOne: false
      referencedRelation: "workout_template_exercises"
      referencedColumns: ["id"]
    }
                  ]
                },"workout_templates": {
                  Row: {
                    "activity_type": string,"duration_s": number | null,"id": string,"name": string,"notes": string | null,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "activity_type": string,"duration_s"?: number | null,"id"?: string,"name": string,"notes"?: string | null,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "activity_type"?: string,"duration_s"?: number | null,"id"?: string,"name"?: string,"notes"?: string | null,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "workout_templates_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"workouts": {
                  Row: {
                    "activity_type": string,"distance_m": number | null,"duration_s": number | null,"ended_at": string,"energy_kcal": number | null,"health_device_id": string | null,"health_uuid": string | null,"id": string,"notes": string | null,"source": string,"source_app": string | null,"source_key": string | null,"started_at": string,"timezone": string,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "activity_type": string,"distance_m"?: number | null,"duration_s"?: number | null,"ended_at": string,"energy_kcal"?: number | null,"health_device_id"?: string | null,"health_uuid"?: string | null,"id"?: string,"notes"?: string | null,"source": string,"source_app"?: string | null,"source_key"?: string | null,"started_at": string,"timezone": string,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "activity_type"?: string,"distance_m"?: number | null,"duration_s"?: number | null,"ended_at"?: string,"energy_kcal"?: number | null,"health_device_id"?: string | null,"health_uuid"?: string | null,"id"?: string,"notes"?: string | null,"source"?: string,"source_app"?: string | null,"source_key"?: string | null,"started_at"?: string,"timezone"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "workouts_user_id_fkey"
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
            "apply_health_changes":
{ Args: { "p_daily": Json,"p_device": string,"p_metric": string,"p_owner": string,"p_remove_daily": (string)[],"p_remove_weight": (string)[],"p_weight": Json }; Returns: undefined
                           },
"apply_health_water":
{ Args: { "p_device": string,"p_owner": string,"p_remove": (string)[],"p_samples": Json }; Returns: undefined
                           },
"apply_health_workouts":
{ Args: { "p_device": string,"p_owner": string,"p_remove": (string)[],"p_workouts": Json }; Returns: undefined
                           },
"competition_invite":
{ Args: { "p_code": string,"p_id": string }; Returns: Json
                           },
"competition_live_scores":
{ Args: { "p_id": string }; Returns: {
              "eligibility": string,"excluded_entries": number,"health_entries": number,"manual_entries": number,"score": number,"updated_at": string,"user_id": string
            }[]
                           },
"competition_standings":
{ Args: { "p_id": string }; Returns: {
              "display_name": string,"eligibility": string,"excluded_entries": number,"health_entries": number,"manual_entries": number,"rank": number,"score": number,"updated_at": string,"user_id": string
            }[]
                           },
"create_competition":
{ Args: { "p_end_day": string,"p_group_id": string,"p_include_manual"?: boolean,"p_metric": string,"p_name": string,"p_start_day": string,"p_timezone": string }; Returns: string
                           },
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
"delete_my_food_history":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"delete_my_health_imports":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"delete_my_water_history":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"finalize_competition":
{ Args: { "p_id": string }; Returns: undefined
                           },
"food_daily_totals":
{ Args: { "p_from": string,"p_to": string }; Returns: {
              "carbs_g": number,"carbs_g_incomplete": boolean,"energy_kcal": number,"energy_kcal_incomplete": boolean,"entries": number,"fat_g": number,"fat_g_incomplete": boolean,"local_date": string,"protein_g": number,"protein_g_incomplete": boolean
            }[]
                           },
"food_search_allow":
{ Args: { "p_global_limit": number,"p_limit": number,"p_user": string }; Returns: boolean
                           },
"gen_invite_code":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"group_food":
{ Args: { "p_from": string,"p_group_id": string,"p_to": string }; Returns: {
              "carbs_g": number,"carbs_g_incomplete": boolean,"energy_kcal": number,"energy_kcal_incomplete": boolean,"fat_g": number,"fat_g_incomplete": boolean,"local_date": string,"protein_g": number,"protein_g_incomplete": boolean,"user_id": string
            }[]
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
"group_water":
{ Args: { "p_from": string,"p_group_id": string,"p_to": string }; Returns: {
              "local_date": string,"total_ml": number,"user_id": string
            }[]
                           },
"group_workouts":
{ Args: { "p_from": string,"p_group_id": string,"p_to": string }; Returns: {
              "total_duration_s": number,"user_id": string,"week_start": string,"workout_count": number
            }[]
                           },
"import_workouts":
{ Args: { "p_app": string,"p_workouts": Json }; Returns: number
                           },
"is_group_member":
{ Args: { "p_group_id": string }; Returns: boolean
                           },
"join_competition":
{ Args: { "p_id": string }; Returns: undefined
                           },
"join_group":
{ Args: { "code": string }; Returns: string
                           },
"leave_competition":
{ Args: { "p_id": string }; Returns: undefined
                           },
"moderate_competition":
{ Args: { "p_action": string,"p_id": string,"p_reason": string,"p_user_id"?: string }; Returns: undefined
                           },
"my_competition_contributions":
{ Args: { "p_id": string }; Returns: {
              "flagged": boolean,"included": boolean,"measured_on": string,"reason": string,"record_id": string,"source": string,"updated_at": string,"value": number
            }[]
                           },
"record_health_export":
{ Args: { "p_device": string,"p_kind": string,"p_record_id": string,"p_sample_uuid": string,"p_version": number }; Returns: boolean
                           },
"regenerate_invite_code":
{ Args: { "p_group_id": string }; Returns: string
                           },
"remove_member":
{ Args: { "p_group_id": string,"p_user_id": string }; Returns: undefined
                           },
"save_food_recipe":
{ Args: { "p_id": string,"p_recipe": Json }; Returns: string
                           },
"save_manual_workout":
{ Args: { "p_id": string,"p_workout": Json }; Returns: string
                           },
"save_workout_template":
{ Args: { "p_id": string,"p_template": Json }; Returns: string
                           },
"shares_group_with":
{ Args: { "p_user_id": string }; Returns: boolean
                           },
"water_daily_totals":
{ Args: { "p_from": string,"p_to": string }; Returns: {
              "entries": number,"health_ml": number,"health_received_at": string,"last_entry_at": string,"local_date": string,"manual_ml": number,"total_ml": number
            }[]
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
