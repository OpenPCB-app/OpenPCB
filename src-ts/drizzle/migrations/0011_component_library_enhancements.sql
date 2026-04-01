-- Migration: Component Library Enhancements
-- Adds category, tags, unitCount, and 3D model paths

-- Add new columns to component_family
ALTER TABLE component_family ADD COLUMN category_path TEXT;
ALTER TABLE component_family ADD COLUMN tags TEXT DEFAULT '[]';

-- Add 3D model asset paths to model_3d_option
ALTER TABLE model_3d_option ADD COLUMN step_asset_path TEXT;
ALTER TABLE model_3d_option ADD COLUMN gltf_preview_path TEXT;
