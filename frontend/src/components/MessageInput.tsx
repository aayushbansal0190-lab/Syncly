import { useEffect, useRef, useState } from "react";
import { useChatStore } from "../store/useChatStore";
import { Image, Send, X, Paperclip, FileText, Smile, Mic, Square } from "lucide-react";
import toast from "react-hot-toast";
import imageCompression from "browser-image-compression";

// Allowed document types, keyed by extension. We also use this to force a correct
// MIME type when the browser reports an empty one (common for .zip/.txt), so the
// server's data-URL type check always sees a valid, allowlisted type.
const EXT_TO_MIME: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  txt: "text/plain",
  zip: "application/zip",
};
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB, matches the backend limit
const FILE_ACCEPT = ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip";

// A small curated set — enough to be useful without pulling in a picker library.
const EMOJIS = [
  "😀", "😂", "🤣", "😊", "😍", "🥰", "😎", "🙃", "😉", "😅",
  "👍", "👎", "🙏", "👏", "🙌", "💪", "👋", "🤝", "🔥", "✨",
  "🎉", "❤️", "💯", "😭", "😢", "😡", "🤔", "😴", "🥳", "😱",
  "😘", "🥺", "😬", "👀", "💀", "✅", "❌", "⭐", "☕", "🍕",
];

// A document/voice note chosen but not yet sent (data is a base64 data URL).
interface FilePreview {
  data: string;
  name: string;
  type: string;
  size: number;
}

const MessageInput = () => {
  const [text, setText] = useState("");
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [filePreview, setFilePreview] = useState<FilePreview | null>(null);
  const [showEmoji, setShowEmoji] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const docInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { sendMessage, isSendingMessage } = useChatStore();

  const isAudioPreview = filePreview?.type.startsWith("audio/");

  const handleImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      toast.error("Please select an image file");
      return;
    }

    const options = { maxSizeMB: 1, maxWidthOrHeight: 1024, useWebWorker: true };
    const compressedFile = await imageCompression(file, options);

    const reader = new FileReader();
    reader.onloadend = () => setImagePreview(reader.result as string);
    reader.readAsDataURL(compressedFile);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const ext = file.name.split(".").pop()?.toLowerCase();
    const mime = ext ? EXT_TO_MIME[ext] : undefined;
    if (!mime) {
      toast.error("File type not allowed");
      return;
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      toast.error("File is too large (max 5MB)");
      return;
    }

    const typedBlob = file.type === mime ? file : new Blob([file], { type: mime });
    const reader = new FileReader();
    reader.onloadend = () => {
      setFilePreview({ data: reader.result as string, name: file.name, type: mime, size: file.size });
    };
    reader.readAsDataURL(typedBlob);
  };

  // ===== Voice recording (browser MediaRecorder) =====
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        // Release the mic once we're done.
        stream.getTracks().forEach((t) => t.stop());
        const mime = (recorder.mimeType || "audio/webm").split(";")[0];
        const blob = new Blob(chunksRef.current, { type: mime });
        if (blob.size > MAX_FILE_SIZE_BYTES) {
          toast.error("Recording too long (max 5MB)");
          return;
        }
        const reader = new FileReader();
        reader.onloadend = () => {
          setFilePreview({
            data: reader.result as string,
            name: "voice-message",
            type: mime,
            size: blob.size,
          });
        };
        reader.readAsDataURL(blob);
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);
      setRecordSeconds(0);
      timerRef.current = setInterval(() => setRecordSeconds((s) => s + 1), 1000);
    } catch {
      toast.error("Couldn't access the microphone");
    }
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
    setIsRecording(false);
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  // Cleanup the timer if the component unmounts mid-recording.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const removeImage = () => {
    setImagePreview(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeFile = () => {
    setFilePreview(null);
    if (docInputRef.current) docInputRef.current.value = "";
  };

  const insertEmoji = (emoji: string) => setText((prev) => prev + emoji);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim() && !imagePreview && !filePreview) return;

    try {
      await sendMessage({ text: text.trim(), image: imagePreview, file: filePreview });

      setText("");
      setImagePreview(null);
      setFilePreview(null);
      setShowEmoji(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
      if (docInputRef.current) docInputRef.current.value = "";
    } catch (error) {
      console.error("Failed to send message:", error);
    }
  };

  const mmss = `${Math.floor(recordSeconds / 60)}:${String(recordSeconds % 60).padStart(2, "0")}`;

  return (
    <div className="p-4 w-full relative">
      {(imagePreview || filePreview) && (
        <div className="mb-3 flex items-center gap-2">
          {imagePreview && (
            <div className="relative">
              <img
                src={imagePreview}
                alt="Preview"
                className="w-20 h-20 object-cover rounded-lg border border-base-300"
              />
              <button
                onClick={removeImage}
                className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-base-300 flex items-center justify-center"
                type="button"
              >
                <X className="size-3" />
              </button>
            </div>
          )}

          {filePreview && (
            <div className="relative flex items-center gap-2 px-3 py-2 rounded-lg border border-base-300 max-w-[260px]">
              {isAudioPreview ? (
                // Voice note preview: a small player so you can hear it before sending.
                <audio controls src={filePreview.data} className="h-9 max-w-[210px]" />
              ) : (
                <>
                  <FileText className="size-5 shrink-0" />
                  <span className="text-sm truncate">{filePreview.name}</span>
                </>
              )}
              <button
                onClick={removeFile}
                className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-base-300 flex items-center justify-center"
                type="button"
              >
                <X className="size-3" />
              </button>
            </div>
          )}
        </div>
      )}

      {/* Emoji picker popover */}
      {showEmoji && (
        <div className="absolute bottom-20 left-4 z-30 w-64 bg-base-100 border border-base-300 rounded-xl shadow-lg p-2 grid grid-cols-8 gap-1">
          {EMOJIS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              className="text-xl hover:bg-base-200 rounded p-0.5"
              onClick={() => insertEmoji(emoji)}
            >
              {emoji}
            </button>
          ))}
        </div>
      )}

      <form onSubmit={handleSendMessage} className="flex items-center gap-2">
        <div className="flex-1 flex gap-2">
          {isRecording ? (
            // While recording, replace the text field with a live recording bar.
            <div className="flex-1 flex items-center gap-2 input input-bordered input-sm sm:input-md">
              <span className="size-2.5 rounded-full bg-red-500 animate-pulse" />
              <span className="text-sm">Recording… {mmss}</span>
            </div>
          ) : (
            <input
              type="text"
              className="w-full input input-bordered rounded-lg input-sm sm:input-md"
              placeholder="Type a message..."
              value={text}
              onChange={(e) => setText(e.target.value)}
              disabled={isSendingMessage}
            />
          )}

          <input type="file" accept="image/*" className="hidden" ref={fileInputRef} onChange={handleImageChange} />
          <input type="file" accept={FILE_ACCEPT} className="hidden" ref={docInputRef} onChange={handleFileChange} />

          {/* Emoji */}
          <button
            type="button"
            className={`hidden sm:flex btn btn-circle ${showEmoji ? "text-primary" : "text-base-content/60"}`}
            onClick={() => setShowEmoji((s) => !s)}
            disabled={isSendingMessage || isRecording}
            title="Emoji"
          >
            <Smile size={20} />
          </button>

          {/* Voice note: toggles record / stop */}
          <button
            type="button"
            className={`btn btn-circle ${isRecording ? "text-red-500" : "text-base-content/60"}`}
            onClick={isRecording ? stopRecording : startRecording}
            disabled={isSendingMessage}
            title={isRecording ? "Stop recording" : "Record voice message"}
          >
            {isRecording ? <Square size={18} /> : <Mic size={20} />}
          </button>

          <button
            type="button"
            className={`hidden sm:flex btn btn-circle ${imagePreview ? "text-emerald-500" : "text-base-content/60"}`}
            onClick={() => fileInputRef.current?.click()}
            disabled={isSendingMessage || isRecording}
            title="Attach image"
          >
            <Image size={20} />
          </button>
          <button
            type="button"
            className={`hidden sm:flex btn btn-circle ${filePreview && !isAudioPreview ? "text-emerald-500" : "text-base-content/60"}`}
            onClick={() => docInputRef.current?.click()}
            disabled={isSendingMessage || isRecording}
            title="Attach file"
          >
            <Paperclip size={20} />
          </button>
        </div>
        <button
          type="submit"
          className="btn btn-sm btn-circle"
          disabled={(!text.trim() && !imagePreview && !filePreview) || isSendingMessage || isRecording}
        >
          <Send size={22} />
        </button>
      </form>
    </div>
  );
};
export default MessageInput;
