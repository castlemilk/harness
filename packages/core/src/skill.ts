export interface SkillArg {
  name: string;
  type: string;
  required: boolean;
  description?: string;
}

export interface SkillManifest {
  name: string;
  description: string;
  args: SkillArg[];
  instructions: string;
}

export interface SkillArtifact {
  id: string;
  name: string;
  sourcePath: string;
  generatedPath: string;
  manifest: SkillManifest;
  registeredAt: Date;
}
