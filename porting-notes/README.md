# Porting notes

API and design notes written by the agents that ported each group of modules, continuing
PORTING.md §12. Read the note for a module before importing it: it records exported names and
signatures, representation choices, async decisions, toolkit additions and known differences
from the Haskell original.

| Note | Modules |
|------|---------|
| [g1](g1.md) | `Reactive.Banana.GI.{Connect,ErrorBox,Menu,Common,DataIconTheme,Table}`, `Reactive.Banana.GI` |
| [g2](g2.md) | `Reactive.Banana.GI.ArrowDialog` (GTK gadget interpreter) |
| [da](da.md) | banana-ui `demo-arrow` program |
| [n1](n1.md) | `Model.GI.Notebooks`, `Model.GI.PackageTree`, `Test.GI.PackageTree` |
| [md](md.md) | `Model.GI.ModelDiagrams` (editor windows, script interpreter, history hooks) |
| [ex](ex.md) | `Model.GI.Export` |
| [mm](mm.md) | `App.ModelMain` (main window, browser history, drag-and-drop, unload guard) |
| [wel](wel.md) | `App.Welcome` |
| [q1](q1.md) | `Model.Query.Diagram` |
| [mb](mb.md) | `Model.Matrices.Base` |
| [mx](mx.md) | `Model.Matrices.{Design,Excel,Screen}` |
| [r1](r1.md) | `Model.Report.{Base,Html,Docx,Docx.*}`, `Test.Report.TestDocument` |
| [rd](rd.md) | `Model.Report.Dialogs` |
| [bt](bt.md) | `Model.Abstract.BasicTypes` |
| [ev](ev.md) | `Evidence.Model`, `App.Appearance` |
| [gd](gd.md) | `App.GenericDiagram` |
| [gsn](gsn.md) | `GSN.Model` |
| [cm](cm.md) | `Causality.Model` |
| [cr](cr.md) | `Causality.Risk` |
| [sc](sc.md) | `DSM.SafetyCase`, dsm `Main` |
| [w1](w1.md) | webits core: `Control.Concurrent.TState`, `Data.ForestModel`, `Network.Webits{,.Icons,.StyleSheets,.Menu}` |
| [w2](w2.md) | `Network.Webits.{ArrowDialog,Table}` |
| [w3](w3.md) | webits `demo-webit` program |
| [qa1](qa1.md) | Whole-app testing of diagrams and editing: toolkit fixes and behaviours confirmed against the original |
| [qa2](qa2.md) | Whole-app testing of reports, matrices, import/export and dialogs |
