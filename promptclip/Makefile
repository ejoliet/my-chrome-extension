.PHONY: package clean

package:
	@rm -f promptclip.zip
	@zip -r promptclip.zip . -x "*.DS_Store" -x "private/*" -x "*.git/*" >/dev/null
	@echo "Created promptclip.zip"

clean:
	@rm -f promptclip.zip
