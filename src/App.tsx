/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenAI, GenerateContentResponse } from "@google/genai";
import { Upload, FileText, Image as ImageIcon, Loader2, Download, Trash2, Scissors, CheckCircle2, AlertCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import * as pdfjsLib from 'pdfjs-dist';

// Configure PDF.js worker
// Using a CDN for the worker to avoid complex local setup
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

interface BoundingBox {
  ymin: number;
  xmin: number;
  ymax: number;
  xmax: number;
  label?: string;
}

interface ExtractedSignature {
  id: string;
  url: string;
  box: BoundingBox;
}

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [signatures, setSignatures] = useState<ExtractedSignature[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('');
  
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      processFile(selectedFile);
    }
  };

  const processFile = async (selectedFile: File) => {
    setFile(selectedFile);
    setSignatures([]);
    setError(null);
    setStatus('Loading file...');
    
    const url = URL.createObjectURL(selectedFile);
    
    if (selectedFile.type === 'application/pdf') {
      try {
        const loadingTask = pdfjsLib.getDocument(url);
        const pdf = await loadingTask.promise;
        const page = await pdf.getPage(1);
        const viewport = page.getViewport({ scale: 2 });
        
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.height = viewport.height;
        canvas.width = viewport.width;
        
        if (context) {
          await page.render({ canvasContext: context, viewport }).promise;
          const dataUrl = canvas.toDataURL('image/png');
          setPreviewUrl(dataUrl);
        }
      } catch (err) {
        console.error('PDF error:', err);
        setError('Failed to process PDF. Please try an image instead.');
      }
    } else {
      setPreviewUrl(url);
    }
  };

  const extractSignatures = async () => {
    if (!previewUrl) return;
    
    setIsProcessing(true);
    setError(null);
    setStatus('Analyzing document with AI...');
    
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      
      // Convert data URL to base64
      const base64Data = previewUrl.split(',')[1];
      
      const prompt = `
        Find all handwritten signatures in this document. 
        Return the bounding boxes for each signature in a JSON array of objects with the following format:
        [{"ymin": 0-1000, "xmin": 0-1000, "ymax": 0-1000, "xmax": 0-1000, "label": "signature"}]
        
        The coordinates should be normalized from 0 to 1000.
        Only return the JSON array, nothing else.
      `;

      const response: GenerateContentResponse = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: {
          parts: [
            { text: prompt },
            { inlineData: { data: base64Data, mimeType: "image/png" } }
          ]
        },
        config: {
          responseMimeType: "application/json"
        }
      });

      const resultText = response.text;
      const boxes: BoundingBox[] = JSON.parse(resultText);
      
      if (!Array.isArray(boxes) || boxes.length === 0) {
        setError("No signatures detected. Try a clearer image.");
        setIsProcessing(false);
        return;
      }

      setStatus('Cropping signatures...');
      await cropSignatures(boxes);
      
    } catch (err) {
      console.error('AI error:', err);
      setError('Failed to extract signatures. Please check your connection or try again.');
    } finally {
      setIsProcessing(false);
      setStatus('');
    }
  };

  const cropSignatures = async (boxes: BoundingBox[]) => {
    const img = new Image();
    img.src = previewUrl!;
    
    await new Promise((resolve) => {
      img.onload = resolve;
    });

    const newSignatures: ExtractedSignature[] = [];
    
    boxes.forEach((box, index) => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      
      // Convert normalized coordinates back to pixel coordinates
      const x = (box.xmin / 1000) * img.width;
      const y = (box.ymin / 1000) * img.height;
      const width = ((box.xmax - box.xmin) / 1000) * img.width;
      const height = ((box.ymax - box.ymin) / 1000) * img.height;
      
      // Add some padding
      const padding = 10;
      const px = Math.max(0, x - padding);
      const py = Math.max(0, y - padding);
      const pw = Math.min(img.width - px, width + padding * 2);
      const ph = Math.min(img.height - py, height + padding * 2);

      canvas.width = pw;
      canvas.height = ph;
      
      if (ctx) {
        ctx.drawImage(img, px, py, pw, ph, 0, 0, pw, ph);
        newSignatures.push({
          id: `sig-${index}-${Date.now()}`,
          url: canvas.toDataURL('image/png'),
          box
        });
      }
    });

    setSignatures(newSignatures);
  };

  const downloadSignature = (url: string, id: string) => {
    const link = document.createElement('a');
    link.href = url;
    link.download = `signature-${id}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const reset = () => {
    setFile(null);
    setPreviewUrl(null);
    setSignatures([]);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className="min-h-screen bg-[#F5F5F5] text-[#1A1A1A] font-sans selection:bg-[#4A4A4A] selection:text-white">
      {/* Header */}
      <header className="border-b border-[#E5E5E5] bg-white px-6 py-4 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-[#1A1A1A] rounded-xl flex items-center justify-center text-white">
            <Scissors className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Signature Extractor</h1>
            <p className="text-xs text-[#9E9E9E] uppercase tracking-widest font-medium">AI-Powered Document Tool</p>
          </div>
        </div>
        {file && (
          <button 
            onClick={reset}
            className="text-xs font-medium uppercase tracking-wider text-[#9E9E9E] hover:text-[#1A1A1A] transition-colors flex items-center gap-2"
          >
            <Trash2 className="w-4 h-4" />
            Clear All
          </button>
        )}
      </header>

      <main className="max-w-7xl mx-auto p-6 md:p-10">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
          
          {/* Left Column: Upload & Preview */}
          <div className="lg:col-span-7 space-y-6">
            {!file ? (
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="aspect-[4/3] w-full border-2 border-dashed border-[#D1D1D1] rounded-3xl bg-white flex flex-col items-center justify-center p-10 text-center group hover:border-[#1A1A1A] transition-all cursor-pointer relative overflow-hidden"
                onClick={() => fileInputRef.current?.click()}
              >
                <div className="w-20 h-20 bg-[#F5F5F5] rounded-full flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                  <Upload className="w-8 h-8 text-[#4A4A4A]" />
                </div>
                <h2 className="text-xl font-medium mb-2">Drop your document here</h2>
                <p className="text-[#9E9E9E] max-w-xs mx-auto">Upload a PDF or Image to extract handwritten signatures automatically.</p>
                <input 
                  type="file" 
                  ref={fileInputRef}
                  onChange={handleFileChange}
                  accept="application/pdf,image/*"
                  className="hidden"
                />
              </motion.div>
            ) : (
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="bg-white rounded-3xl shadow-sm border border-[#E5E5E5] overflow-hidden"
              >
                <div className="p-4 border-b border-[#E5E5E5] flex items-center justify-between bg-[#FAFAFA]">
                  <div className="flex items-center gap-3">
                    {file.type === 'application/pdf' ? <FileText className="w-5 h-5" /> : <ImageIcon className="w-5 h-5" />}
                    <span className="text-sm font-medium truncate max-w-[200px]">{file.name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={extractSignatures}
                      disabled={isProcessing}
                      className="bg-[#1A1A1A] text-white px-5 py-2 rounded-full text-sm font-medium hover:bg-[#333333] transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                    >
                      {isProcessing ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Processing...
                        </>
                      ) : (
                        <>
                          <Scissors className="w-4 h-4" />
                          Extract Signatures
                        </>
                      )}
                    </button>
                  </div>
                </div>
                <div className="p-6 bg-[#F9F9F9] flex justify-center min-h-[400px]">
                  {previewUrl && (
                    <img 
                      src={previewUrl} 
                      alt="Preview" 
                      className="max-w-full h-auto shadow-lg rounded-lg border border-[#E5E5E5]"
                      referrerPolicy="no-referrer"
                    />
                  )}
                </div>
              </motion.div>
            )}

            {error && (
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-red-50 border border-red-100 p-4 rounded-2xl flex items-start gap-3 text-red-600"
              >
                <AlertCircle className="w-5 h-5 mt-0.5 flex-shrink-0" />
                <p className="text-sm font-medium">{error}</p>
              </motion.div>
            )}
          </div>

          {/* Right Column: Results */}
          <div className="lg:col-span-5 space-y-6">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold uppercase tracking-widest text-[#9E9E9E]">Extracted Results</h3>
              {signatures.length > 0 && (
                <span className="text-xs font-bold bg-[#1A1A1A] text-white px-2 py-0.5 rounded-full">
                  {signatures.length}
                </span>
              )}
            </div>

            <div className="space-y-4">
              <AnimatePresence mode="popLayout">
                {signatures.length === 0 ? (
                  <motion.div 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="bg-white border border-[#E5E5E5] border-dashed rounded-3xl p-12 text-center"
                  >
                    <div className="w-12 h-12 bg-[#F5F5F5] rounded-full flex items-center justify-center mx-auto mb-4">
                      <Scissors className="w-5 h-5 text-[#D1D1D1]" />
                    </div>
                    <p className="text-sm text-[#9E9E9E]">Signatures will appear here after extraction.</p>
                  </motion.div>
                ) : (
                  signatures.map((sig, idx) => (
                    <motion.div
                      key={sig.id}
                      initial={{ opacity: 0, x: 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: idx * 0.1 }}
                      className="bg-white rounded-3xl border border-[#E5E5E5] p-6 group hover:shadow-md transition-all"
                    >
                      <div className="flex items-center justify-between mb-6">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 bg-green-100 text-green-600 rounded-full flex items-center justify-center">
                            <CheckCircle2 className="w-4 h-4" />
                          </div>
                          <span className="text-xs font-bold uppercase tracking-wider">Signature #{idx + 1}</span>
                        </div>
                        <button 
                          onClick={() => downloadSignature(sig.url, sig.id)}
                          className="p-2 hover:bg-[#F5F5F5] rounded-full transition-colors"
                          title="Download"
                        >
                          <Download className="w-5 h-5 text-[#4A4A4A]" />
                        </button>
                      </div>
                      <div className="aspect-video bg-[#F9F9F9] rounded-2xl border border-[#F0F0F0] flex items-center justify-center p-8 overflow-hidden">
                        <img 
                          src={sig.url} 
                          alt={`Signature ${idx + 1}`} 
                          className="max-w-full max-h-full object-contain group-hover:scale-110 transition-transform duration-500"
                          referrerPolicy="no-referrer"
                        />
                      </div>
                    </motion.div>
                  ))
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </main>

      {/* Status Overlay */}
      <AnimatePresence>
        {isProcessing && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-white/80 backdrop-blur-sm z-50 flex flex-col items-center justify-center"
          >
            <div className="w-16 h-16 relative mb-6">
              <div className="absolute inset-0 border-4 border-[#F0F0F0] rounded-full"></div>
              <div className="absolute inset-0 border-4 border-[#1A1A1A] rounded-full border-t-transparent animate-spin"></div>
            </div>
            <p className="text-lg font-medium tracking-tight">{status}</p>
            <p className="text-sm text-[#9E9E9E] mt-2">This may take a few seconds...</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
