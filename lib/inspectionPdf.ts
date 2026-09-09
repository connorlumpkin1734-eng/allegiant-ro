import { PDFCheckBox, PDFDocument, PDFTextField, StandardFonts, rgb } from "pdf-lib";

/** Export a customer-facing report without interactive field highlighting. */
export async function finishInspectionPdf(pdf: PDFDocument) {
  const form = pdf.getForm();
  const black = rgb(0, 0, 0);
  for (const field of form.getFields()) {
    if (field instanceof PDFTextField) {
      form.markFieldAsDirty(field.ref);
      field.acroField.setDefaultAppearance("/Helv 8 Tf 0 g");
      for (const widget of field.acroField.getWidgets()) {
        // Keep the last customer-info field inside the template's outer box.
        if (field.getName() === "technician") {
          const rect = widget.getRectangle();
          const page = pdf.getPages().find((entry) => entry.ref === widget.P());
          if (!page) throw new Error("Could not locate the technician field on the PDF.");
          // The original field outline is also painted into the template.
          page.drawRectangle({ x: rect.x - 1, y: rect.y - 1, width: rect.width + 2,
            height: rect.height + 2, color: rgb(1, 1, 1) });
          page.drawLine({ start: { x: rect.x - 1, y: rect.y + 4 },
            end: { x: rect.x + rect.width + 1, y: rect.y + 4 },
            color: rgb(0.68, 0.73, 0.8), thickness: 0.75 });
          widget.setRectangle({ ...rect, y: rect.y + 6, height: rect.height - 6 });
        }
        const appearance = widget.getOrCreateAppearanceCharacteristics();
        appearance.setBorderColor([0, 0, 0]);
        appearance.setBackgroundColor([1, 1, 1]);
      }
    } else if (field instanceof PDFCheckBox) {
      const name = field.getName();
      const color = name.includes("_good_") ? rgb(0.09, 0.47, 0.29)
        : name.includes("_monitor_") ? rgb(0.72, 0.46, 0)
        : name.includes("_service_") ? rgb(0.71, 0.13, 0.18)
        : name.startsWith("trans_") ? rgb(0.06, 0.15, 0.30) : black;
      for (const widget of field.acroField.getWidgets()) {
        const page = pdf.getPages().find((entry) => entry.ref === widget.P());
        if (!page) throw new Error("Could not locate an inspection status on the PDF.");
        const { x, y, width, height } = widget.getRectangle();
        const centerX = x + width / 2;
        const centerY = y + height / 2;
        // Cover the template's circle and replace the square form appearance.
        page.drawCircle({ x: centerX, y: centerY, size: width / 2 + 1, color: rgb(1, 1, 1) });
        page.drawCircle({ x: centerX, y: centerY, size: width / 2 - 0.5,
          color: field.isChecked() ? color : rgb(1, 1, 1), borderColor: color, borderWidth: 1 });
        if (field.isChecked()) {
          page.drawLine({ start: { x: x + width * 0.24, y: y + height * 0.5 },
            end: { x: x + width * 0.43, y: y + height * 0.3 }, thickness: 1.5, color: rgb(1, 1, 1) });
          page.drawLine({ start: { x: x + width * 0.43, y: y + height * 0.3 },
            end: { x: x + width * 0.78, y: y + height * 0.72 }, thickness: 1.5, color: rgb(1, 1, 1) });
        }
      }
      form.removeField(field);
    }
  }
  form.updateFieldAppearances(await pdf.embedFont(StandardFonts.Helvetica));
  form.flatten();
  return pdf.save();
}
