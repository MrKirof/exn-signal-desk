import "../../src/styles.css";
import { createRoot } from "react-dom/client";
import { LabShell } from "../../src/components/lab/lab-shell";

const root = document.getElementById("root");
if (root) createRoot(root).render(<LabShell />);
