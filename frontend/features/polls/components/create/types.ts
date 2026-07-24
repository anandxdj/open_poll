export type QuestionForm = {
  _id?: string;
  text: string;
  isMandatory: boolean;
  options: string[];
  type?: 'single' | 'multiple';
  correctOptionIndices?: number[];
  explanation?: string;
  points?: number;
};
