# import fitz  
# import pytesseract
# from PIL import Image
# import io

# # If on Windows, uncomment and set your path:
# pytesseract.pytesseract.tesseract_cmd = r"C:\Program Files\Tesseract-OCR\tesseract.exe"

# def extract_first_image(pdf_path):
#     """Extract the first image found in a PDF"""
#     doc = fitz.open(pdf_path)
#     for page_index, page in enumerate(doc):
#         images = page.get_images(full=True)
#         if images:
#             xref = images[0][0]
#             base_image = doc.extract_image(xref)
#             image_bytes = base_image["image"]
#             image = Image.open(io.BytesIO(image_bytes))
#             print(f"✅ Found image on page {page_index + 1}")
#             return image
#     print("⚠️ No images found in the PDF.")
#     return None


# def analyze_image_locally(image: Image.Image):
#     """Run OCR on image and print detected text"""
#     ocr_text = pytesseract.image_to_string(image)
#     print("🧠 OCR Detected Text:")
#     print("--------------------")
#     print(ocr_text if ocr_text.strip() else "No text detected in image.")
#     print("--------------------")
#     return ocr_text


# if __name__ == "__main__":
#     pdf_path = "pdf-example-bookmarks.pdf"  
#     image = extract_first_image(pdf_path)
#     if image:
#         image.show()
#         analyze_image_locally(image)

import fitz  # PyMuPDF
import pytesseract
from PIL import Image
import io
import os

# If on Windows, uncomment and set your path:
pytesseract.pytesseract.tesseract_cmd = r"C:\Program Files\Tesseract-OCR\tesseract.exe"

def extract_all_images(pdf_path, output_dir="extracted_images"):
    """Extract all images from a PDF and save them locally"""
    os.makedirs(output_dir, exist_ok=True)
    doc = fitz.open(pdf_path)
    image_list = []

    for page_index, page in enumerate(doc):
        images = page.get_images(full=True)
        print(f"📄 Page {page_index + 1}: Found {len(images)} image(s).")
        for img_index, img in enumerate(images):
            xref = img[0]
            base_image = doc.extract_image(xref)
            image_bytes = base_image["image"]
            image_ext = base_image["ext"]
            image = Image.open(io.BytesIO(image_bytes))

            filename = f"page{page_index+1}_img{img_index+1}.{image_ext}"
            filepath = os.path.join(output_dir, filename)
            image.save(filepath)
            print(f"✅ Saved: {filename}")
            image_list.append(filepath)
    
    if not image_list:
        print("⚠️ No images found in the entire PDF.")
    return image_list


def analyze_images_with_ocr(image_paths):
    """Run OCR on all extracted images"""
    for path in image_paths:
        print(f"\n🔍 Analyzing: {path}")
        image = Image.open(path)
        ocr_text = pytesseract.image_to_string(image)
        print("🧠 OCR Detected Text:")
        print("--------------------")
        print(ocr_text.strip() if ocr_text.strip() else "No text detected.")
        print("--------------------")


if __name__ == "__main__":
    pdf_path = "pdf-example-bookmarks.pdf"  # change to your file
    image_paths = extract_all_images(pdf_path)
    if image_paths:
        analyze_images_with_ocr(image_paths)

