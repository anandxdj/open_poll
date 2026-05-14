"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { 
  Plus, 
  Trash2, 
  ArrowLeft,
  Settings2,
  Check,
  ListChecks,
  Users,
  Layout,
  Smartphone,
  Sparkles,
  ChevronRight,
  Monitor,
  Eye,
  Clock,
  MoreVertical,
  X
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";

// --- Types ---
interface QuestionForm {
  id: string;
  text: string;
  isMandatory: boolean;
  options: string[];
}

const generateId = () => Math.random().toString(36).substring(2, 9);

const emptyQuestion = (): QuestionForm => ({
  id: generateId(),
  text: "",
  isMandatory: true,
  options: ["Option 1", "Option 2"],
});

export default function MinimalProStudioPage() {
  const router = useRouter();
  
  // --- State ---
  const [title, setTitle] = useState("Research Survey");
  const [questions, setQuestions] = useState<QuestionForm[]>([emptyQuestion()]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [isPreview, setIsPreview] = useState(false);

  const activeQ = questions[activeIdx];

  // --- Actions ---
  const addQuestion = () => {
    setQuestions([...questions, emptyQuestion()]);
    setActiveIdx(questions.length);
  };

  const removeQuestion = (idx: number) => {
    if (questions.length <= 1) return;
    setQuestions(questions.filter((_, i) => i !== idx));
    setActiveIdx(Math.max(0, idx - 1));
  };

  const updateQuestion = (patch: Partial<QuestionForm>) => {
    setQuestions(questions.map((q, i) => i === activeIdx ? { ...q, ...patch } : q));
  };

  const updateOption = (oIdx: number, val: string) => {
    const nextOpts = [...activeQ.options];
    nextOpts[oIdx] = val;
    updateQuestion({ options: nextOpts });
  };

  const addOption = () => updateQuestion({ options: [...activeQ.options, ""] });

  const removeOption = (oIdx: number) => {
    if (activeQ.options.length <= 2) return;
    updateQuestion({ options: activeQ.options.filter((_, j) => j !== oIdx) });
  };

  return (
    <div className="h-screen w-full flex flex-col bg-white dark:bg-zinc-950 overflow-hidden text-zinc-900 dark:text-zinc-100 font-sans antialiased">
      
      {/* --- Global Header --- */}
      <header className="h-14 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between px-4 bg-white dark:bg-zinc-950 z-50">
        <div className="flex items-center gap-4">
          <button onClick={() => router.back()} className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-900 rounded-md text-zinc-500 transition-colors">
            <ArrowLeft className="size-4" />
          </button>
          <div className="h-4 w-px bg-zinc-200 dark:bg-zinc-800" />
          <input 
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="bg-transparent border-none p-0 text-sm font-semibold focus:ring-0 w-64 placeholder:text-zinc-300 dark:placeholder:text-zinc-700"
            placeholder="Untitled Poll"
          />
        </div>

        <div className="flex items-center gap-2">
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={() => setIsPreview(!isPreview)}
            className="text-xs font-bold text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            {isPreview ? <Monitor className="size-3.5 mr-2" /> : <Eye className="size-3.5 mr-2" />}
            {isPreview ? "Exit Preview" : "Preview"}
          </Button>
          <Button className="bg-yellow-400 text-black hover:bg-yellow-500 font-bold rounded-lg px-6 h-8 text-xs transition-all active:scale-95 shadow-none border-none">
             Deploy
          </Button>
        </div>
      </header>

      <main className="flex-grow flex overflow-hidden">
        
        {/* LEFT: Compact List Navigator */}
        {!isPreview && (
          <aside className="w-64 border-r border-zinc-200 dark:border-zinc-800 flex flex-col bg-zinc-50/50 dark:bg-zinc-900/30">
            <div className="p-4 flex flex-col gap-1 flex-grow overflow-y-auto custom-scrollbar">
              <div className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest px-2 mb-2">Sections</div>
              {questions.map((q, i) => (
                <button
                  key={q.id}
                  onClick={() => setActiveIdx(i)}
                  className={cn(
                    "w-full flex items-center gap-3 p-2.5 rounded-lg transition-all text-left group relative",
                    activeIdx === i 
                      ? "bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 shadow-sm" 
                      : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800/50 border border-transparent"
                  )}
                >
                  <span className="text-[10px] font-bold tabular-nums shrink-0 opacity-40">{String(i + 1).padStart(2, '0')}</span>
                  <span className="truncate text-xs font-semibold flex-grow">
                    {q.text || "Untitled Question"}
                  </span>
                  {activeIdx === i && <div className="absolute left-[-1px] top-2 bottom-2 w-0.5 bg-yellow-400 rounded-full" />}
                </button>
              ))}
              <button 
                onClick={addQuestion}
                className="w-full flex items-center gap-3 p-2.5 rounded-lg text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 transition-all text-xs font-bold mt-2 border border-dashed border-zinc-200 dark:border-zinc-800"
              >
                <Plus className="size-3.5" />
                Add Section
              </button>
            </div>
            <div className="p-4 border-t border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950">
               <div className="flex items-center justify-between text-[10px] font-bold text-zinc-400 uppercase tracking-wider">
                  <span>Progress</span>
                  <span>{questions.filter(q => q.text.trim()).length} / {questions.length}</span>
               </div>
               <div className="mt-2 h-1 w-full bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-yellow-400 transition-all duration-500" 
                    style={{ width: `${(questions.filter(q => q.text.trim()).length / questions.length) * 100}%` }} 
                  />
               </div>
            </div>
          </aside>
        )}

        {/* RIGHT: Main Editor Area */}
        <section className={cn(
          "flex-grow bg-white dark:bg-zinc-950 relative overflow-y-auto",
          isPreview && "flex items-center justify-center p-8 bg-zinc-50 dark:bg-zinc-900"
        )}>
          
          <AnimatePresence mode="wait">
            {isPreview ? (
              <motion.div 
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                className="w-full max-w-sm aspect-[9/19] bg-white dark:bg-zinc-950 rounded-[3rem] shadow-2xl border-[8px] border-zinc-900 dark:border-zinc-800 flex flex-col overflow-hidden relative"
              >
                {/* Notch */}
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-32 h-6 bg-zinc-900 dark:border-zinc-800 rounded-b-2xl z-10" />
                
                <div className="p-8 pt-16 flex-grow overflow-y-auto custom-scrollbar">
                   <div className="space-y-8">
                      {questions.map((q, i) => (
                        <div key={q.id} className="space-y-6">
                           <div className="space-y-2">
                              <span className="text-[10px] font-black text-yellow-500 uppercase tracking-widest">Question {i+1}</span>
                              <h3 className="text-xl font-bold leading-tight">{q.text || "..."}</h3>
                           </div>
                           <div className="space-y-2">
                              {q.options.map((opt, oi) => (
                                <div key={oi} className="h-12 border border-zinc-200 dark:border-zinc-800 rounded-xl flex items-center px-4 text-sm font-medium hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors cursor-pointer">
                                   {opt || "..."}
                                </div>
                              ))}
                           </div>
                           {i < questions.length - 1 && <div className="h-px bg-zinc-100 dark:bg-zinc-800" />}
                        </div>
                      ))}
                      <Button className="w-full bg-zinc-900 dark:bg-white text-white dark:text-black font-bold h-12 rounded-xl mt-8">Submit Results</Button>
                   </div>
                </div>
              </motion.div>
            ) : (
              <motion.div
                key={activeIdx}
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                className="max-w-2xl mx-auto py-20 px-6 space-y-12"
              >
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <span className="text-[10px] font-black text-yellow-500 uppercase tracking-widest">Editing Section {activeIdx + 1}</span>
                    <h2 className="text-2xl font-bold tracking-tight">Question Canvas</h2>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                       <span className="text-[10px] font-bold text-zinc-400 uppercase">Required</span>
                       <Switch checked={activeQ.isMandatory} onCheckedChange={(v) => updateQuestion({ isMandatory: v })} className="scale-75" />
                    </div>
                    <button onClick={() => removeQuestion(activeIdx)} className="p-2 text-zinc-300 hover:text-red-500 transition-colors">
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                </div>

                <div className="space-y-8">
                  {/* Title Area */}
                  <div className="space-y-3">
                    <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">The Prompt</label>
                    <textarea 
                      value={activeQ.text}
                      onChange={(e) => updateQuestion({ text: e.target.value })}
                      placeholder="Enter your question here..."
                      className="w-full bg-transparent border-none p-0 focus:ring-0 text-3xl font-bold placeholder:text-zinc-200 dark:placeholder:text-zinc-800 resize-none min-h-[120px]"
                    />
                    <button className="flex items-center gap-2 text-[10px] font-black uppercase text-blue-500 hover:text-blue-600 transition-colors">
                       <Sparkles className="size-3" /> Optimize with AI Intelligence
                    </button>
                  </div>

                  {/* Options Area */}
                  <div className="space-y-4 pt-4">
                    <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Response Choices</label>
                    <div className="space-y-3">
                       {activeQ.options.map((opt, oi) => (
                         <div key={oi} className="flex gap-3 items-center group">
                            <div className="h-12 flex-grow border border-zinc-200 dark:border-zinc-800 rounded-xl flex items-center px-4 gap-4 bg-white dark:bg-zinc-950 focus-within:border-yellow-400 focus-within:ring-2 focus-within:ring-yellow-400/5 transition-all">
                               <span className="text-[10px] font-bold text-zinc-300 group-hover:text-zinc-900 dark:group-hover:text-zinc-100">{oi + 1}</span>
                               <input 
                                 value={opt}
                                 onChange={(e) => updateOption(oi, e.target.value)}
                                 className="flex-grow bg-transparent border-none p-0 focus:ring-0 text-sm font-semibold"
                                 placeholder={`Choice ${oi + 1}`}
                               />
                            </div>
                            {activeQ.options.length > 2 && (
                              <button onClick={() => removeOption(oi)} className="p-2 text-zinc-300 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100">
                                <Trash2 className="size-4" />
                              </button>
                            )}
                         </div>
                       ))}
                       <button 
                        onClick={addOption}
                        className="w-full h-12 border-2 border-dashed border-zinc-100 dark:border-zinc-800 rounded-xl flex items-center justify-center gap-2 text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 transition-all font-bold text-xs"
                       >
                         <Plus className="size-3.5" />
                         Add Choice
                       </button>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

        </section>

      </main>

      {/* --- Global System Footer --- */}
      <footer className="h-10 border-t border-zinc-200 dark:border-zinc-800 flex items-center justify-between px-6 bg-white dark:bg-zinc-950 text-[9px] font-bold uppercase tracking-[0.2em] text-zinc-400">
         <div className="flex items-center gap-8">
            <span className="flex items-center gap-2"><div className="size-1.5 rounded-full bg-emerald-500" /> System Online</span>
            <span className="flex items-center gap-2"><ListChecks className="size-3.5" /> {questions.length} Active Modules</span>
         </div>
         <div className="flex items-center gap-6">
            <span>Lat: 12ms</span>
            <span className="flex items-center gap-2 text-blue-500"><Sparkles className="size-3" /> AI Ready</span>
         </div>
      </footer>

    </div>
  );
}
